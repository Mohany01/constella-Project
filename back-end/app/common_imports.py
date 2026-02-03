"""Shared imports and helpers for LangGraph nodes.

Import this module instead of repeating long import lists.
"""

from __future__ import annotations

import os
import json
from pathlib import Path
from typing import Any, List, Tuple, TypedDict, cast, Dict

from dotenv import load_dotenv
from langchain_groq import ChatGroq
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage
from langchain_core.prompts import ChatPromptTemplate
from langgraph.graph import StateGraph, END
from pydantic import BaseModel, Field, validator, RootModel

# File loading (PDF / DOCX) with fallbacks and friendly errors
try:
    from pypdf import PdfReader  # preferred modern package
except ImportError:
    try:
        from PyPDF2 import PdfReader  # fallback to older package name
    except ImportError as exc:  # pragma: no cover - import guard
        raise ImportError("Install a PDF reader: pip install pypdf (or PyPDF2)") from exc

try:
    from docx import Document  # provided by the python-docx package
except ImportError as exc:  # pragma: no cover - import guard
    try:
        import docx  # type: ignore

        Document = docx.Document
    except Exception:
        raise ImportError("Install python-docx: pip install python-docx") from exc


def load_env() -> None:
    """Load .env from the backend folder."""
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")


def make_llm(model: str = "llama-3.3-70b-versatile", temperature: float = 0) -> ChatGroq:
    """Factory for the Groq chat model with env-based API key."""
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError("GROQ_API_KEY not set in .env")
    return ChatGroq(model=model, api_key=api_key, temperature=temperature)


__all__ = [
    # stdlib
    "os",
    "json",
    "Path",
    "Any",
    "List",
    "Tuple",
    "TypedDict",
    "cast",
    "Dict",
    # langchain / langgraph
    "AIMessage",
    "BaseMessage",
    "HumanMessage",
    "ChatPromptTemplate",
    "ChatGroq",
    "StateGraph",
    "END",
    # pydantic
    "BaseModel",
    "Field",
    "validator",
    "RootModel",
    # file helpers
    "PdfReader",
    "Document",
    # helpers
    "load_env",
    "make_llm",
]
