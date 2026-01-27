from pydantic import BaseModel, EmailStr, constr

# ----------------------
# Request Schemas
# ----------------------
class SignupRequest(BaseModel):
    name: constr(min_length=1, max_length=50)
    email: EmailStr
    password: constr(min_length=6, max_length=128)

class LoginRequest(BaseModel):
    email: EmailStr
    password: constr(min_length=6, max_length=128)

# ----------------------
# Response Schemas
# ----------------------
class MessageResponse(BaseModel):
    message: str

class UserResponse(BaseModel):
    name: str
    email: EmailStr
