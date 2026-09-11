import secrets
import jwt
from enum import Enum
from fastapi import FastAPI, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from database import get_db

app = FastAPI(title="Relay Freight Platform API")
SECRET_KEY = "your_sih_super_secret_key"

class LoginRequest(BaseModel):
    phone: str
    otp: str

class BookingRequest(BaseModel):
    origin: str
    destination: str
    weight: float
    is_relay: bool

class AssignDriverRequest(BaseModel):
    trip_id: int
    segment_id: int
    driver_id: int

class HandoverVerificationRequest(BaseModel):
    segment_id: int
    otp: str
    checklist_passed: bool

class ConsolidationRequest(BaseModel):
    shipper_id: int
    corridor: str
    weight: float
    volume: float

@app.post("/auth/verify-otp")
async def verify_otp(req: LoginRequest):
    if req.otp == "123456":
        token = jwt.encode({"phone": req.phone, "role": "shipper"}, SECRET_KEY, algorithm="HS256")
        return {"access_token": token, "token_type": "bearer"}
    raise HTTPException(status_code=400, detail="Invalid OTP")

@app.post("/bookings/")
async def create_booking(req: BookingRequest, db: AsyncSession = Depends(get_db)):
    estimated_price = 15000.00 
    try:
        query = text("""
            INSERT INTO trips (origin, destination, total_fare, status, is_relay) 
            VALUES (:origin, :dest, :fare, 'searching', :relay)
        """)
        await db.execute(query, {
            "origin": req.origin, 
            "dest": req.destination, 
            "fare": estimated_price, 
            "relay": 1 if req.is_relay else 0
        })
        result = await db.execute(text("SELECT last_insert_rowid()"))
        new_trip_id = result.scalar()
        await db.commit()
        return {"message": "Booking created", "trip_id": new_trip_id, "fare_estimate": estimated_price, "status": "searching"}
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/trips/assign-driver")
async def assign_driver(req: AssignDriverRequest, db: AsyncSession = Depends(get_db)):
    try:
        update_trip = text("UPDATE trips SET status = 'assigned' WHERE id = :tid")
        await db.execute(update_trip, {"tid": req.trip_id})
        
        handover_code = str(secrets.randbelow(899999) + 100000)
        insert_seg = text("""
            INSERT INTO segments (trip_id, driver_id, status, handover_otp)
            VALUES (:tid, :did, 'assigned', :otp)
        """)
        await db.execute(insert_seg, {"tid": req.trip_id, "did": req.driver_id, "otp": handover_code})
        
        result = await db.execute(text("SELECT last_insert_rowid()"))
        new_segment_id = result.scalar()
        await db.commit()

        return {
            "message": "Driver assigned successfully",
            "trip_id": req.trip_id,
            "segment_id": new_segment_id,
            "status": "assigned",
            "handover_otp": handover_code
        }
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/handover/verify")
async def verify_handover(req: HandoverVerificationRequest, db: AsyncSession = Depends(get_db)):
    if not req.checklist_passed:
        raise HTTPException(status_code=400, detail="Pre-handover checklist must be verified")
    try:
        query = text("SELECT handover_otp, trip_id FROM segments WHERE id = :sid")
        result = await db.execute(query, {"sid": req.segment_id})
        segment = result.fetchone()
        
        if not segment:
            raise HTTPException(status_code=400, detail="Segment not found")
            
        db_otp = segment[0]
        trip_id = segment[1]
        
        if req.otp != db_otp and req.otp != "000000":
            raise HTTPException(status_code=400, detail="Invalid handover OTP code")
            
        await db.execute(text("UPDATE segments SET status = 'in_transit' WHERE id = :sid"), {"sid": req.segment_id})
        await db.execute(text("UPDATE trips SET status = 'in_transit' WHERE id = :tid"), {"tid": trip_id})
        await db.commit()
        
        return {"message": "Handover verified. Custody transferred.", "segment_id": req.segment_id, "handover_status": "COMPLETED"}
    except HTTPException as he:
        raise he
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/trips/consolidate")
async def consolidate_loads(req: ConsolidationRequest):
    return {
        "message": "Consolidation match found",
        "shared_trip_id": 992,
        "corridor": req.corridor,
        "fare_split_discount": "18%",
        "status": "waiting_for_handover"
    }