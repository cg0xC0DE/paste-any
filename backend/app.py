#!/usr/bin/env python3
"""
Paste-Any Backend Service
FastAPI service for text paste sharing
"""

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from pathlib import Path

from storage import save_paste, get_paste, cleanup_expired

# 创建 FastAPI 应用
app = FastAPI(
    title="Paste-Any",
    description="快速文本传输服务 - 存入文本，获得提取码",
    version="1.0.0"
)

# CORS 中间件
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# 请求/响应模型
class PasteRequest(BaseModel):
    content: str


class PasteResponse(BaseModel):
    code: str
    expires_at: str
    message: str


class GetResponse(BaseModel):
    content: str
    created_at: str


class ErrorResponse(BaseModel):
    error: str


# 健康检查
@app.get("/api/health")
async def health_check():
    """健康检查"""
    return {"status": "ok", "service": "paste-any"}


# 存入文本
@app.post("/api/pastes", response_model=PasteResponse)
async def create_paste(request: PasteRequest):
    """
    存入文本，返回提取码

    - content: 要传输的文本内容
    - 返回: 4位提取码和过期时间
    """
    if not request.content or not request.content.strip():
        raise HTTPException(status_code=400, detail="内容不能为空")

    if len(request.content) > 2000000:  # 限制单次存储大小 (约2MB for base64 images)
        raise HTTPException(status_code=400, detail="内容过长")

    result = save_paste(request.content)
    return PasteResponse(**result)


# 取出文本
@app.get("/api/pastes/{code}", response_model=GetResponse)
async def get_paste_by_code(code: str):
    """
    凭提取码取出文本

    - code: 4位提取码
    - 返回: 对应的文本内容
    """
    if not code or len(code) != 4:
        raise HTTPException(status_code=400, detail="提取码格式错误")

    result = get_paste(code.upper())

    if result is None:
        raise HTTPException(status_code=404, detail="提取码不存在或已过期")

    return GetResponse(**result)


# 清理过期（可选调用）
@app.post("/api/cleanup")
async def cleanup():
    """清理过期的提取码"""
    count = cleanup_expired()
    return {"cleaned": count}


# 前端页面
@app.get("/")
async def serve_frontend():
    """提供前端页面"""
    frontend_path = Path(__file__).parent.parent / "frontend" / "index.html"
    if frontend_path.exists():
        return FileResponse(frontend_path)
    return {"message": "Paste-Any Backend Running", "docs": "/docs"}


# 启动服务
if __name__ == "__main__":
    print("🚀 Paste-Any Backend on http://localhost:54123")
    print("📝 API Docs: http://localhost:54123/docs")
    uvicorn.run(app, host="0.0.0.0", port=54123)
