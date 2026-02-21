"""Lightweight skill graph helpers for the project analyzer."""

from __future__ import annotations

from typing import Dict, List, Tuple


SkillNode = Dict[str, set]
SkillGraph = Dict[str, SkillNode]


def _add_edge(graph: SkillGraph, parent: str, child: str) -> None:
    parent_key = parent.strip().lower()
    child_key = child.strip().lower()

    if not parent_key or not child_key:
        return

    graph.setdefault(parent_key, {"parents": set(), "children": set()})
    graph.setdefault(child_key, {"parents": set(), "children": set()})
    graph[parent_key]["children"].add(child_key)
    graph[child_key]["parents"].add(parent_key)


def create_skills_graph() -> SkillGraph:
    """Create a small, opinionated skill graph for expansion."""

    graph: SkillGraph = {}
    edges = [
        ("project management", "planning"),
        ("project management", "risk management"),
        ("project management", "stakeholder management"),
        ("planning", "roadmapping"),
        ("planning", "estimation"),
        ("product design", "user research"),
        ("product design", "wireframing"),
        ("product design", "prototyping"),
        ("frontend", "react"),
        ("frontend", "next.js"),
        ("frontend", "tailwind"),
        ("frontend", "typescript"),
        ("frontend", "testing"),
        ("backend", "api design"),
        ("backend", "database"),
        ("backend", "authentication"),
        ("backend", "testing"),
        ("data", "analytics"),
        ("data", "sql"),
        ("data", "dashboarding"),
        ("ai", "prompt engineering"),
        ("ai", "model evaluation"),
        ("ai", "nlp"),
    ]

    for parent, child in edges:
        _add_edge(graph, parent, child)

    return graph


def get_skill_relatives(graph: SkillGraph, skill: str) -> Tuple[List[str], List[str]]:
    """Return parents and children for a skill if present."""

    key = skill.strip().lower()
    node = graph.get(key)
    if not node:
        return [], []
    parents = sorted(node.get("parents", []))
    children = sorted(node.get("children", []))
    return parents, children

