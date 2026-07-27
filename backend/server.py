"""
CRM Backend — FastAPI + MongoDB
Endpoints: auth (register/login), workspaces, leads, columns
"""
from fastapi import FastAPI, APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, ConfigDict
from passlib.context import CryptContext
from dotenv import load_dotenv
import os, jwt, uuid, logging, json
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional
from pathlib import Path

# ── Config ──────────────────────────────────────────────────────────────────
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME   = os.environ.get("DB_NAME", "crm_db")
JWT_SECRET = os.environ.get("JWT_SECRET", "change-me-in-production-secret-key")
JWT_ALGO   = "HS256"
ACCESS_TTL = timedelta(days=30)

# Limite de taille du document MongoDB (16MB dur) — on bloque à 12MB pour garder de la marge
MONGO_DOC_LIMIT_BYTES = 12 * 1024 * 1024  # 12 MB

# Pool de connexions MongoDB explicitement configuré
client = AsyncIOMotorClient(
    MONGO_URL,
    maxPoolSize=50,          # max connexions simultanées
    minPoolSize=5,           # connexions maintenues ouvertes en idle
    serverSelectionTimeoutMS=5000,  # timeout si MongoDB est injoignable
    connectTimeoutMS=5000,
)
db     = client[DB_NAME]

pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer  = HTTPBearer()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# ── App ──────────────────────────────────────────────────────────────────────
app    = FastAPI(title="CRM API")
router = APIRouter(prefix="/api")

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Models ────────────────────────────────────────────────────────────────────
class UserRegister(BaseModel):
    email: str
    password: str
    name: str = ""

class UserLogin(BaseModel):
    email: str
    password: str

class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: Dict[str, Any]

# Workspace & state are stored as a single JSON blob per workspace.
# The frontend sends the entire workspace object; we just persist it.
class WorkspaceIn(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: Optional[str] = None
    name: str
    data: Dict[str, Any] = Field(default_factory=dict)

class WorkspaceOut(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str
    name: str
    data: Dict[str, Any]

# Full CRM state blob (the entire reducer state)
class CrmStateIn(BaseModel):
    model_config = ConfigDict(extra="allow")
    workspaces: Dict[str, Any] = Field(default_factory=dict)
    order: List[str] = Field(default_factory=list)
    currentId: Optional[str] = None
    theme: str = "light"

# ── Auth helpers ──────────────────────────────────────────────────────────────
def hash_pwd(raw: str) -> str:
    return pwd_ctx.hash(raw)

def verify_pwd(raw: str, hashed: str) -> bool:
    return pwd_ctx.verify(raw, hashed)

def create_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "exp": datetime.now(timezone.utc) + ACCESS_TTL,
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)

async def get_current_user(creds: HTTPAuthorizationCredentials = Depends(bearer)):
    try:
        payload = jwt.decode(creds.credentials, JWT_SECRET, algorithms=[JWT_ALGO])
        user_id: str = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Token invalide")
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expiré")
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Token invalide")
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "password": 0})
    if not user:
        raise HTTPException(status_code=401, detail="Utilisateur introuvable")
    return user

# ── Auth routes ───────────────────────────────────────────────────────────────
@router.post("/auth/register", response_model=TokenOut, status_code=201)
async def register(body: UserRegister):
    existing = await db.users.find_one({"email": body.email.lower()})
    if existing:
        raise HTTPException(status_code=409, detail="Email déjà utilisé")
    user_id = str(uuid.uuid4())
    user = {
        "id": user_id,
        "email": body.email.lower().strip(),
        "name": body.name.strip() or body.email.split("@")[0],
        "password": hash_pwd(body.password),
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }
    await db.users.insert_one(user)
    token = create_token(user_id)
    user_out = {k: v for k, v in user.items() if k != "password" and k != "_id"}
    return TokenOut(access_token=token, user=user_out)

@router.post("/auth/login", response_model=TokenOut)
async def login(body: UserLogin):
    user = await db.users.find_one({"email": body.email.lower()})
    if not user or not verify_pwd(body.password, user["password"]):
        raise HTTPException(status_code=401, detail="Email ou mot de passe incorrect")
    token = create_token(user["id"])
    user_out = {k: v for k, v in user.items() if k != "password" and k != "_id"}
    return TokenOut(access_token=token, user=user_out)

@router.get("/auth/me")
async def me(current_user=Depends(get_current_user)):
    return current_user

# ── CRM state routes ──────────────────────────────────────────────────────────
# We persist the ENTIRE CRM state as one document per user.
# This mirrors exactly the localStorage approach, but server-side.

@router.get("/crm/state")
async def get_state(current_user=Depends(get_current_user)):
    """Load the full CRM state for the current user."""
    doc = await db.crm_states.find_one({"userId": current_user["id"]}, {"_id": 0})
    if not doc:
        return {"workspaces": {}, "order": [], "currentId": None, "theme": "light"}
    return doc.get("state", {"workspaces": {}, "order": [], "currentId": None, "theme": "light"})

@router.put("/crm/state")
async def save_state(body: CrmStateIn, current_user=Depends(get_current_user)):
    """Save (upsert) the full CRM state for the current user."""
    # Vérification de taille avant écriture — MongoDB refuse les documents > 16MB.
    # On bloque à 12MB pour garder de la marge de manœuvre (métadonnées BSON, etc.)
    try:
        payload_bytes = len(json.dumps(body.model_dump()).encode("utf-8"))
    except Exception:
        payload_bytes = 0

    if payload_bytes > MONGO_DOC_LIMIT_BYTES:
        size_mb = payload_bytes / (1024 * 1024)
        logger.error(
            f"[CRM] Sauvegarde refusée pour userId={current_user['id']} "
            f"— taille {size_mb:.1f} MB dépasse la limite de {MONGO_DOC_LIMIT_BYTES // (1024*1024)} MB"
        )
        raise HTTPException(
            status_code=413,
            detail=(
                f"Données trop volumineuses ({size_mb:.1f} MB). "
                "Archivez ou supprimez des leads anciens pour libérer de l'espace. "
                f"Limite : {MONGO_DOC_LIMIT_BYTES // (1024*1024)} MB."
            ),
        )

    await db.crm_states.update_one(
        {"userId": current_user["id"]},
        {"$set": {
            "userId": current_user["id"],
            "state": body.model_dump(),
            "updatedAt": datetime.now(timezone.utc).isoformat(),
            "sizeBytes": payload_bytes,
        }},
        upsert=True,
    )
    return {"ok": True, "sizeBytes": payload_bytes}

# ── Health ────────────────────────────────────────────────────────────────────
@router.get("/")
async def root():
    return {"status": "ok", "service": "CRM API"}

@router.get("/health")
async def health():
    return {"status": "ok"}

# ── Register router ───────────────────────────────────────────────────────────
app.include_router(router)

@app.on_event("startup")
async def create_indexes():
    """Crée les indexes MongoDB au démarrage — idempotent, safe à rappeler."""
    try:
        # Index sur users.email (login lookup + contrainte d'unicité)
        await db.users.create_index("email", unique=True, background=True)
        # Index sur users.id (get_current_user lookup)
        await db.users.create_index("id", unique=True, background=True)
        # Index sur crm_states.userId (load/save state lookup)
        await db.crm_states.create_index("userId", unique=True, background=True)
        logger.info("[DB] Indexes créés/vérifiés avec succès.")
    except Exception as e:
        # Ne pas crasher le démarrage si les indexes existent déjà ou si MongoDB est lent
        logger.warning(f"[DB] Création des indexes — avertissement : {e}")

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
