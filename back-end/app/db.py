# app/db.py
import os
import psycopg2
from psycopg2 import extensions, pool
from dotenv import load_dotenv

load_dotenv()  # loads DATABASE_URL from .env

DATABASE_URL = os.getenv("DATABASE_URL")
conn_pool = None


def _init_pool():
    """Create connection pool with keepalive to avoid idle SSL drops."""
    global conn_pool
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL is not set.")
    conn_pool = psycopg2.pool.SimpleConnectionPool(
        minconn=1,
        maxconn=5,
        dsn=DATABASE_URL,
        keepalives=1,
        keepalives_idle=30,
        keepalives_interval=10,
        keepalives_count=5,
    )
    print("Database connection pool (re)created")


# Initialize on import
try:
    _init_pool()
except Exception as e:
    print("Failed to create connection pool")
    print(e)


def _reset_pool():
    """Close all pooled connections and recreate the pool."""
    global conn_pool
    try:
        if conn_pool:
            conn_pool.closeall()
    except Exception:
        pass
    _init_pool()


def _is_connection_healthy(conn) -> bool:
    """Check if a connection is alive by running a lightweight query."""
    if conn is None or conn.closed:
        return False
    try:
        if conn.get_transaction_status() == extensions.TRANSACTION_STATUS_INERROR:
            conn.rollback()
        with conn.cursor() as cur:
            cur.execute("SELECT 1")
            cur.fetchone()
        return True
    except Exception:
        return False


def _discard_connection(conn):
    """Remove a broken connection from the pool."""
    if conn is None:
        return
    try:
        if conn_pool:
            conn_pool.putconn(conn, close=True)
            return
    except Exception:
        pass
    try:
        conn.close()
    except Exception:
        pass


def get_connection():
    """Get a healthy connection; rebuild pool if connections were dropped."""
    global conn_pool
    try:
        if conn_pool is None or conn_pool.closed:
            _init_pool()
        conn = conn_pool.getconn()
        if not _is_connection_healthy(conn):
            _discard_connection(conn)
            try:
                conn = conn_pool.getconn()
            except Exception:
                _reset_pool()
                conn = conn_pool.getconn()
            if not _is_connection_healthy(conn):
                _discard_connection(conn)
                return None
        return conn
    except Exception as e:
        print("Failed to get connection from pool")
        print(e)
        return None


def release_connection(conn):
    if not conn:
        return
    try:
        if conn.closed or conn.status == extensions.STATUS_BAD:
            _discard_connection(conn)
            return
        if conn.get_transaction_status() == extensions.TRANSACTION_STATUS_INERROR:
            conn.rollback()
        if conn_pool:
            conn_pool.putconn(conn)
        else:
            conn.close()
    except Exception:
        _discard_connection(conn)
