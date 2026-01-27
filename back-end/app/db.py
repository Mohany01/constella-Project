# app/db.py
import os
import psycopg2
from psycopg2 import pool
from dotenv import load_dotenv

load_dotenv()  # loads DATABASE_URL from .env

DATABASE_URL = os.getenv("DATABASE_URL")

try:
    conn_pool = psycopg2.pool.SimpleConnectionPool(
        minconn=1,
        maxconn=5,
        dsn=DATABASE_URL
    )
    if conn_pool:
        print("✅ Database connection pool created successfully")
except Exception as e:
    print("❌ Failed to create connection pool")
    print(e)

def get_connection():
    try:
        return conn_pool.getconn()
    except Exception as e:
        print("❌ Failed to get connection from pool")
        print(e)
        return None

def release_connection(conn):
    if conn:
        conn_pool.putconn(conn)
