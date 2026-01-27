# app/test_employee.py
from app.db import get_connection, release_connection
from pprint import pprint  # for nice table-like output

def main():
    conn = None
    try:
        # Get connection from pool
        conn = get_connection()
        if not conn:
            print("❌ Could not get a database connection")
            return

        cur = conn.cursor()

        # Test connection: current user, database, time
        cur.execute("SELECT current_user, current_database(), NOW() as time;")
        res = cur.fetchone()
        print("✅ Connected to Neon!")
        print("Connection test:", res)

        # Fetch rows from employee table
        cur.execute("SELECT * FROM employee;")
        employees = cur.fetchall()
        colnames = [desc[0] for desc in cur.description]  # get column names

        print(f"Found {len(employees)} employee(s):")
        # Print rows nicely
        for row in employees:
            pprint(dict(zip(colnames, row)))

    except Exception as e:
        print("❌ Connection or query failed:")
        print(e)

    finally:
        if conn:
            cur.close()
            release_connection(conn)

if __name__ == "__main__":
    main()
