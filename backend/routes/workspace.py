from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from typing import List, Optional
from bson import ObjectId
from datetime import datetime
import os
import uuid
import shutil

from database import workspace_notes_col, workspace_files_col
from auth import get_current_user
from services.storage_service import storage_service
from pydantic import BaseModel

router = APIRouter(prefix="/workspace", tags=["workspace"])

class WorkspaceNoteCreate(BaseModel):
    title: str
    content: str

class WorkspaceNoteUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None

def serialize(doc: dict) -> dict:
    if doc is None:
        return None
    doc = dict(doc)
    doc["id"] = str(doc.pop("_id"))
    for key, val in doc.items():
        if isinstance(val, datetime):
            doc[key] = val.isoformat()
    return doc

@router.get("/notes")
async def get_notes(current_user=Depends(get_current_user)):
    notes = []
    async for note in workspace_notes_col.find({"created_by": current_user["email"]}).sort("updated_at", -1):
        notes.append(serialize(note))
    return notes

@router.post("/notes")
async def create_note(note_data: WorkspaceNoteCreate, current_user=Depends(get_current_user)):
    doc = {
        "title": note_data.title,
        "content": note_data.content,
        "created_by": current_user["email"],
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow()
    }
    result = await workspace_notes_col.insert_one(doc)
    return {"id": str(result.inserted_id), "message": "Note created successfully"}

@router.put("/notes/{note_id}")
async def update_note(note_id: str, note_data: WorkspaceNoteUpdate, current_user=Depends(get_current_user)):
    try:
        oid = ObjectId(note_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid note ID format")
    
    note = await workspace_notes_col.find_one({"_id": oid, "created_by": current_user["email"]})
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    
    update_doc = {}
    if note_data.title is not None:
        update_doc["title"] = note_data.title
    if note_data.content is not None:
        update_doc["content"] = note_data.content
    
    if update_doc:
        update_doc["updated_at"] = datetime.utcnow()
        await workspace_notes_col.update_one({"_id": oid}, {"$set": update_doc})
        
    return {"message": "Note updated successfully"}

@router.delete("/notes/{note_id}")
async def delete_note(note_id: str, current_user=Depends(get_current_user)):
    try:
        oid = ObjectId(note_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid note ID format")
        
    note = await workspace_notes_col.find_one({"_id": oid, "created_by": current_user["email"]})
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
        
    await workspace_notes_col.delete_one({"_id": oid})
    return {"message": "Note deleted successfully"}

@router.get("/files")
async def get_files(current_user=Depends(get_current_user)):
    files = []
    async for file_doc in workspace_files_col.find({"created_by": current_user["email"]}).sort("created_at", -1):
        files.append(serialize(file_doc))
    return files

@router.post("/files")
async def upload_file(
    file: UploadFile = File(...),
    title: Optional[str] = Form(None),
    current_user=Depends(get_current_user)
):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")
        
    from config import UPLOAD_DIR
    import re
    
    clean_filename = re.sub(r'[^a-zA-Z0-9._-]', '_', file.filename)
    unique_filename = f"{uuid.uuid4().hex[:8]}_{clean_filename}"
    
    # Ensure folder workspace_docs exists inside uploads
    workspace_docs_dir = UPLOAD_DIR / "workspace_docs"
    workspace_docs_dir.mkdir(parents=True, exist_ok=True)
    
    temp_path = workspace_docs_dir / unique_filename
    
    try:
        content = await file.read()
        with open(temp_path, "wb") as f:
            f.write(content)
            
        uploaded_url = await storage_service.upload_file(str(temp_path), unique_filename, folder="workspace_docs")
        
        # Clean up temp file if not local
        if storage_service.is_configured:
            if os.path.exists(temp_path):
                os.remove(temp_path)
                
        doc = {
            "title": title or file.filename,
            "filename": file.filename,
            "file_url": uploaded_url,
            "file_size": len(content),
            "created_by": current_user["email"],
            "created_at": datetime.utcnow()
        }
        
        result = await workspace_files_col.insert_one(doc)
        return {"id": str(result.inserted_id), "file_url": uploaded_url, "message": "File uploaded successfully"}
        
    except Exception as e:
        if os.path.exists(temp_path):
            os.remove(temp_path)
        raise HTTPException(status_code=500, detail=f"Failed to upload file: {str(e)}")

@router.delete("/files/{file_id}")
async def delete_file(file_id: str, current_user=Depends(get_current_user)):
    try:
        oid = ObjectId(file_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid file ID format")
        
    file_doc = await workspace_files_col.find_one({"_id": oid, "created_by": current_user["email"]})
    if not file_doc:
        raise HTTPException(status_code=404, detail="File not found")
        
    # Clean up physical file if stored locally
    file_url = file_doc.get("file_url", "")
    if file_url and "uploads/workspace_docs" in file_url:
        try:
            from config import UPLOAD_DIR
            filename = file_url.split("/")[-1]
            local_path = UPLOAD_DIR / "workspace_docs" / filename
            if local_path.exists():
                os.remove(local_path)
                print(f"[File Cleanup] Workspace PDF removed: {local_path}")
        except Exception as e:
            print(f"[File Cleanup] Warning: Failed to delete physical workspace file: {e}")
            
    await workspace_files_col.delete_one({"_id": oid})
    return {"message": "File deleted successfully"}
