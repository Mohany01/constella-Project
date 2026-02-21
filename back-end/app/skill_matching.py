

import json
import chromadb
from chromadb.utils import embedding_functions

# 1. Initialize ChromaDB
def initialize_db(path="./employee_db", model_name="all-mpnet-base-v2"):
    """Initializes a persistent ChromaDB client and an embedding function."""
    persistent_client = chromadb.PersistentClient(path=path)
    embedding_function = embedding_functions.SentenceTransformerEmbeddingFunction(model_name=model_name)
    return persistent_client, embedding_function
