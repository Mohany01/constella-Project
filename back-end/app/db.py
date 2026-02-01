# app/db.py
import os
import psycopg2
from psycopg2 import pool
from dotenv import load_dotenv

load_dotenv()  # loads DATABASE_URL from .env

DATABASE_URL = os.getenv("DATABASE_URL")
conn_pool = None


def _init_pool():
    """Create connection pool with keepalive to avoid idle SSL drops."""
    global conn_pool
    conn_pool = psycopg2.pool.SimpleConnectionPool(
        minconn=1,
        maxconn=5,
        dsn=DATABASE_URL,
        keepalives=1,
        keepalives_idle=30,
        keepalives_interval=10,
        keepalives_count=5,
    )
    print("✅ Database connection pool (re)created")


# Initialize on import
try:
    _init_pool()
except Exception as e:
    print("❌ Failed to create connection pool")
    print(e)


def get_connection():
    """Get a healthy connection; rebuild pool if connections were dropped."""
    global conn_pool
    try:
        if conn_pool is None or conn_pool.closed:
            _init_pool()
        conn = conn_pool.getconn()
        if conn is None or conn.closed:
            _init_pool()
            conn = conn_pool.getconn()
        return conn
    except Exception as e:
        print("❌ Failed to get connection from pool")
        print(e)
        return None


def release_connection(conn):
    if conn and conn_pool:
        try:
            conn_pool.putconn(conn)
        except Exception:
            pass
