"""
Medora API server (FastAPI)

API: http://127.0.0.1:8000
Docs: http://127.0.0.1:8000/docs
"""

import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        "server.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
    )
