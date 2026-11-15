
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import supabase

from app.routes.master_data import router as master_data_router
from app.routes.history import router as history_router
from app.routes.evaluation import router as evaluation_router
from app.routes.sessions import router as sessions_router
from app.routes.jobs import router as jobs_router


app = FastAPI(
    title="FOKARA API",
    description="Backend Sistem Simulasi Wawancara FOKARA",
    version="1.0.0"
)


# ==========================================
# CORS CONFIGURATION
# ==========================================
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://aisyahhnmf.github.io",
        "https://sheilakamilazahra.github.io",
    ],
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ==========================================
# REGISTER ROUTERS
# ==========================================
app.include_router(master_data_router)
app.include_router(history_router)
app.include_router(evaluation_router)
app.include_router(sessions_router)
app.include_router(jobs_router)


# ==========================================
# ROOT ENDPOINT
# ==========================================
@app.get("/")
def root():
    return {
        "message": "Welcome to FOKARA API!",
        "status": "running"
    }


# ==========================================
# HEALTH CHECK
# ==========================================
@app.get("/health")
def health_check():
    try:
        supabase.table("participants").select("id").limit(1).execute()

        return {
            "status": "healthy",
            "database": "connected"
        }

    except Exception as error:
        return {
            "status": "unhealthy",
            "database": "disconnected",
            "error": str(error)
        }
