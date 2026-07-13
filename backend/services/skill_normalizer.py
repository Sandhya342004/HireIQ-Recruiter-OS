"""
services/skill_normalizer.py
==============================
Stage 3 of the Hybrid Parsing Pipeline — Master Skill Normalization Engine.

Architecture:
  1. Master Skill Dictionary  — canonical skill names
  2. Alias Dictionary         — alternate spellings → canonical
  3. Synonym Dictionary       — abbreviations / variants → canonical
  4. Embedding similarity     — catches unknown skills via semantic proximity
  5. Groq validation          — final disambiguation pass (optional)

Examples:
  Node / NodeJS / Node.js           → Node.js
  JS / Javascript / Java Script     → JavaScript
  Tensor Flow / Tensorflow          → TensorFlow
  Py Torch                          → PyTorch
  ReactJS                           → React

The normalized skills list from this engine is what gets stored in MongoDB
and used by the ranking engine.
"""

import re
import logging
from typing import List, Optional, Set

logger = logging.getLogger(__name__)

# ── rapidfuzz ─────────────────────────────────────────────────────────────────
_HAS_FUZZY = False
try:
    from rapidfuzz import fuzz, process as rfprocess
    _HAS_FUZZY = True
except ImportError:
    pass


# ═══════════════════════════════════════════════════════════════════════════════
#  MASTER SKILL DICTIONARY  (canonical lowercase names — single source of truth)
# ═══════════════════════════════════════════════════════════════════════════════

MASTER_SKILLS: Set[str] = {
    # ── Programming Languages ─────────────────────────────────────────────────
    "python", "java", "javascript", "typescript", "c++", "c#", "c", "go",
    "rust", "kotlin", "swift", "ruby", "php", "scala", "matlab", "perl", "bash",
    "shell", "powershell", "r", "julia", "dart", "elixir", "haskell", "lua",
    "assembly", "cobol", "fortran", "groovy", "objective-c", "vba",

    # ── Web Frontend ──────────────────────────────────────────────────────────
    "html", "css", "react", "angular", "vue", "svelte", "next.js", "nuxt.js",
    "gatsby", "remix", "jquery", "bootstrap", "tailwind", "sass", "scss",
    "webpack", "vite", "babel", "redux", "mobx", "graphql", "rest api",
    "websocket", "pwa", "webassembly",

    # ── Web Backend ───────────────────────────────────────────────────────────
    "node.js", "express", "django", "flask", "fastapi", "spring boot", "spring",
    "asp.net", "laravel", "rails", "gin", "fiber", "nestjs", "strapi",
    "phoenix", "sinatra", "hapi", "koa",

    # ── Mobile ───────────────────────────────────────────────────────────────
    "react native", "flutter", "android", "ios", "xamarin", "ionic", "cordova",

    # ── Data / ML / AI ───────────────────────────────────────────────────────
    "machine learning", "deep learning", "nlp", "natural language processing",
    "computer vision", "tensorflow", "pytorch", "keras", "scikit-learn",
    "pandas", "numpy", "matplotlib", "seaborn", "plotly", "xgboost",
    "lightgbm", "catboost", "hugging face", "transformers",
    "sentence-transformers", "bert", "gpt", "llm", "rag",
    "reinforcement learning", "neural network", "cnn", "rnn", "lstm",
    "generative ai", "stable diffusion", "langchain", "llamaindex",
    "openai", "cohere", "anthropic", "ollama",

    # ── Data Engineering ─────────────────────────────────────────────────────
    "sql", "mysql", "postgresql", "sqlite", "mongodb", "redis", "cassandra",
    "dynamodb", "elasticsearch", "neo4j", "influxdb", "clickhouse",
    "apache spark", "hadoop", "kafka", "airflow", "dbt", "snowflake",
    "databricks", "bigquery", "redshift", "tableau", "power bi",
    "looker", "metabase", "apache superset", "dask", "polars", "flink",
    "hive", "pig", "sqoop", "nifi",

    # ── Cloud / DevOps ────────────────────────────────────────────────────────
    "aws", "azure", "gcp", "google cloud", "docker", "kubernetes",
    "terraform", "ansible", "puppet", "chef", "jenkins", "github actions",
    "gitlab ci", "circleci", "travis ci", "linux", "unix", "git",
    "nginx", "apache", "helm", "istio", "prometheus", "grafana",
    "elk stack", "splunk", "datadog", "newrelic", "cloudformation",
    "pulumi", "vagrant", "packer", "argocd", "flux",

    # ── Security ─────────────────────────────────────────────────────────────
    "cybersecurity", "penetration testing", "ethical hacking", "siem",
    "firewalls", "oauth", "jwt", "ssl", "encryption", "devsecops",

    # ── Testing ──────────────────────────────────────────────────────────────
    "unit testing", "integration testing", "selenium", "cypress", "jest",
    "pytest", "junit", "mocha", "chai", "testng", "playwright",

    # ── Methodologies ────────────────────────────────────────────────────────
    "agile", "scrum", "kanban", "devops", "ci/cd", "microservices",
    "rest", "soap", "grpc", "tdd", "bdd", "ddd", "solid",
    "communication", "leadership", "teamwork", "problem solving",
    "project management", "data analysis", "excel", "jira", "confluence",
    "product management",

    # ── Blockchain ───────────────────────────────────────────────────────────
    "blockchain", "solidity", "ethereum", "web3", "smart contracts",
}

# ═══════════════════════════════════════════════════════════════════════════════
#  ALIAS DICTIONARY — covers every known variant/misspelling → canonical form
# ═══════════════════════════════════════════════════════════════════════════════

ALIASES: dict[str, str] = {
    # JavaScript
    "js": "javascript",
    "java script": "javascript",
    "es6": "javascript",
    "es2015": "javascript",
    "es2016": "javascript",
    "es2017": "javascript",
    "es2018": "javascript",
    "ecmascript": "javascript",
    "vanilla js": "javascript",
    "vanillajs": "javascript",

    # TypeScript
    "ts": "typescript",
    "type script": "typescript",

    # Python
    "py": "python",
    "python3": "python",
    "python 3": "python",

    # React
    "reactjs": "react",
    "react.js": "react",
    "react js": "react",

    # Node.js
    "node": "node.js",
    "nodejs": "node.js",
    "node js": "node.js",
    "node.js": "node.js",

    # Next.js
    "nextjs": "next.js",
    "next js": "next.js",
    "next": "next.js",

    # Vue
    "vuejs": "vue",
    "vue.js": "vue",
    "vue js": "vue",

    # Angular
    "angularjs": "angular",
    "angular js": "angular",
    "angular2": "angular",
    "angular 2": "angular",

    # Go
    "golang": "go",

    # C variants
    "c language": "c",
    "clang": "c",

    # Machine Learning
    "ml": "machine learning",
    "ai/ml": "machine learning",
    "ai ml": "machine learning",
    "artificial intelligence": "machine learning",
    "ai": "machine learning",

    # Deep Learning
    "dl": "deep learning",

    # NLP
    "natural language processing": "nlp",
    "text mining": "nlp",

    # TensorFlow
    "tf": "tensorflow",
    "tensor flow": "tensorflow",
    "tensor-flow": "tensorflow",
    "keras api": "keras",

    # PyTorch
    "py torch": "pytorch",
    "py-torch": "pytorch",

    # scikit-learn
    "scikit": "scikit-learn",
    "sklearn": "scikit-learn",
    "sci-kit learn": "scikit-learn",

    # Hugging Face
    "hf": "hugging face",
    "huggingface": "hugging face",

    # XGBoost / LightGBM
    "xgb": "xgboost",
    "lgbm": "lightgbm",

    # Cloud
    "amazon web services": "aws",
    "amazon aws": "aws",
    "google cloud platform": "gcp",
    "google cloud": "gcp",
    "microsoft azure": "azure",
    "azure cloud": "azure",

    # Kubernetes
    "k8s": "kubernetes",
    "kube": "kubernetes",

    # Docker
    "containerization": "docker",
    "containers": "docker",

    # CI/CD
    "cicd": "ci/cd",
    "ci cd": "ci/cd",
    "continuous integration": "ci/cd",
    "continuous deployment": "ci/cd",
    "continuous delivery": "ci/cd",

    # Databases
    "postgres": "postgresql",
    "psql": "postgresql",
    "mongo": "mongodb",
    "dynamo": "dynamodb",
    "elastic": "elasticsearch",
    "es": "elasticsearch",
    "redis cache": "redis",

    # Spring
    "spring framework": "spring boot",
    "spring mvc": "spring boot",

    # FastAPI
    "fast api": "fastapi",
    "fast-api": "fastapi",

    # GraphQL
    "gql": "graphql",

    # REST
    "rest": "rest api",
    "restful": "rest api",
    "rest apis": "rest api",
    "restful api": "rest api",
    "restful apis": "rest api",
    "api": "rest api",

    # Testing
    "unit test": "unit testing",
    "unit tests": "unit testing",

    # Data Viz
    "powerbi": "power bi",
    "power-bi": "power bi",
    "ms excel": "excel",
    "microsoft excel": "excel",

    # Spark
    "spark": "apache spark",
    "pyspark": "apache spark",

    # Git platforms
    "git hub": "git",
    "github": "git",
    "gitlab": "git",
    "bitbucket": "git",

    # Linux
    "linux/unix": "linux",
    "unix/linux": "linux",
    "bash scripting": "bash",
    "shell scripting": "bash",

    # React Native
    "react native app": "react native",
    "rn": "react native",

    # Flutter
    "flutter sdk": "flutter",

    # LLM / GenAI
    "llm models": "llm",
    "large language model": "llm",
    "large language models": "llm",
    "generative artificial intelligence": "generative ai",
    "gen ai": "generative ai",
    "genai": "generative ai",
    "langchain framework": "langchain",
    "llama index": "llamaindex",

    # Misc
    "data structure": "data analysis",
    "data structures": "data analysis",
    "dsa": "data analysis",
    "oop": "solid",
    "object oriented": "solid",
    "object-oriented": "solid",
    "object oriented programming": "solid",
}

# Build lookup sets
_CANONICAL_SET: set[str] = {s.lower() for s in MASTER_SKILLS}
_ALIAS_MAP: dict[str, str] = {k.lower(): v.lower() for k, v in ALIASES.items()}


# ═══════════════════════════════════════════════════════════════════════════════
#  Embedding similarity cache (lazy-loaded, optional)
# ═══════════════════════════════════════════════════════════════════════════════

_embed_model = None
_master_skill_embeddings = None
_master_skill_list: list[str] = []


def _get_embed_model():
    """Lazy-load the BGE embedding model for unknown skill resolution."""
    global _embed_model
    if _embed_model is None:
        try:
            from sentence_transformers import SentenceTransformer
            logger.info("[SkillNorm] Loading BGE embedding model for skill similarity ...")
            _embed_model = SentenceTransformer("BAAI/bge-large-en-v1.5")
            logger.info("[SkillNorm] BGE model loaded for skill normalization.")
        except Exception as exc:
            logger.warning("[SkillNorm] Could not load BGE model: %s. Embedding similarity disabled.", exc)
            _embed_model = False
    return _embed_model if _embed_model is not False else None


def _get_master_embeddings():
    """Pre-compute and cache embeddings for all master skills."""
    global _master_skill_embeddings, _master_skill_list
    if _master_skill_embeddings is None:
        model = _get_embed_model()
        if not model:
            _master_skill_embeddings = False
            return None, []
        try:
            import numpy as np
            _master_skill_list = sorted(_CANONICAL_SET)
            logger.info("[SkillNorm] Computing master skill embeddings (%d skills) ...", len(_master_skill_list))
            _master_skill_embeddings = model.encode(
                _master_skill_list,
                normalize_embeddings=True,
                batch_size=64,
                show_progress_bar=False,
            ).astype("float32")
            logger.info("[SkillNorm] Master skill embeddings ready.")
        except Exception as exc:
            logger.warning("[SkillNorm] Failed to compute master embeddings: %s", exc)
            _master_skill_embeddings = False
            return None, []
    if _master_skill_embeddings is False:
        return None, []
    return _master_skill_embeddings, _master_skill_list


def _embedding_match(token: str, threshold: float = 0.82) -> Optional[str]:
    """Use embedding cosine similarity to match an unknown token to a master skill."""
    import numpy as np
    emb_matrix, skill_list = _get_master_embeddings()
    if emb_matrix is None or not skill_list:
        return None
    model = _get_embed_model()
    if not model:
        return None
    try:
        query_emb = model.encode([token], normalize_embeddings=True).astype("float32")
        scores = (emb_matrix @ query_emb.T).flatten()
        best_idx = int(scores.argmax())
        best_score = float(scores[best_idx])
        if best_score >= threshold:
            return skill_list[best_idx]
    except Exception:
        pass
    return None


# ═══════════════════════════════════════════════════════════════════════════════
#  Core normalization function
# ═══════════════════════════════════════════════════════════════════════════════

def normalize_skill(raw: str, use_embeddings: bool = False) -> Optional[str]:
    """
    Normalize a single raw skill token to its canonical form.

    Cascade:
      1. Exact match in master set
      2. Alias lookup
      3. Fuzzy match (rapidfuzz, score ≥ 88)
      4. Embedding similarity (BGE, cosine ≥ 0.82)
      5. Return None if no match found
    """
    if not raw:
        return None
    token = raw.strip().lower()
    token = re.sub(r"\s+", " ", token)

    # 1. Exact match
    if token in _CANONICAL_SET:
        return token

    # 2. Alias lookup
    canon = _ALIAS_MAP.get(token)
    if canon:
        return canon

    # 3. Fuzzy match
    if _HAS_FUZZY and len(token) >= 3:
        match = rfprocess.extractOne(
            token,
            list(_CANONICAL_SET),
            scorer=fuzz.ratio,
            score_cutoff=88,
        )
        if match:
            return match[0]

    # 4. Embedding similarity (for unknown/novel skills)
    if use_embeddings and len(token) >= 3:
        em = _embedding_match(token)
        if em:
            return em

    return None


# ═══════════════════════════════════════════════════════════════════════════════
#  Bulk skill extraction from text
# ═══════════════════════════════════════════════════════════════════════════════

def _extract_skills_section(text: str) -> str:
    """Extract the 'Skills' section from a resume for targeted fuzzy matching."""
    patterns = [
        r'(?:key\s+)?(?:technical\s+)?skills?\s*[:：]?\s*\n(.*?)(?:\n\s*\n|\n[A-Z][A-Z\s]{4,}\n|\Z)',
        r'core\s+competenc(?:y|ies)\s*[:：]?\s*\n(.*?)(?:\n\s*\n|\n[A-Z][A-Z\s]{4,}\n|\Z)',
        r'(?:areas?\s+of\s+)?expertise\s*[:：]?\s*\n(.*?)(?:\n\s*\n|\n[A-Z][A-Z\s]{4,}\n|\Z)',
        r'(?:professional|functional|primary|secondary)\s+skills?\s*[:：]?\s*\n(.*?)(?:\n\s*\n|\n[A-Z][A-Z\s]{4,}\n|\Z)',
        r'(?:key\s+)?skills?\s*[:：]\s*(.+?)(?:\n\n|\n[A-Z]|\Z)',
    ]
    for pat in patterns:
        m = re.search(pat, text, re.IGNORECASE | re.DOTALL)
        if m:
            return m.group(1)[:2000]
    return ""


def extract_and_normalize_skills(text: str) -> List[str]:
    """
    Full 5-stage skill extraction pipeline from raw resume/JD text.

    Stage 1: Exact keyword scan of master skills
    Stage 2: Alias/synonym normalization on n-grams
    Stage 3: Fuzzy matching within the skills section
    Stage 4: Embedding similarity for unknown skills (optional)
    Stage 5: Final deduplication and sorting

    Returns sorted, deduplicated list of canonical skill names.
    """
    text_lower = text.lower()
    found: set[str] = set()

    # Stage 1 — exact keyword scan
    for skill in MASTER_SKILLS:
        pattern = r'\b' + re.escape(skill) + r'\b'
        if re.search(pattern, text_lower):
            found.add(skill)

    # Stage 2 — n-gram alias lookup
    words = re.findall(r"[a-z][a-z0-9.#+\-/]*", text_lower)
    for i, w in enumerate(words):
        canon = normalize_skill(w, use_embeddings=False)
        if canon:
            found.add(canon)
        if i + 1 < len(words):
            bigram = w + " " + words[i + 1]
            canon = normalize_skill(bigram, use_embeddings=False)
            if canon:
                found.add(canon)
        if i + 2 < len(words):
            trigram = w + " " + words[i + 1] + " " + words[i + 2]
            canon = normalize_skill(trigram, use_embeddings=False)
            if canon:
                found.add(canon)

    # Stage 3 — fuzzy matching within skills section
    if _HAS_FUZZY:
        skills_section = _extract_skills_section(text)
        if skills_section:
            tokens = re.split(r'[,;|\n•·▪\-]+', skills_section)
            for tok in tokens:
                tok = tok.strip().lower()
                if not tok or len(tok) < 2 or len(tok) > 35:
                    continue
                if tok in _CANONICAL_SET or tok in _ALIAS_MAP:
                    continue
                match = rfprocess.extractOne(
                    tok, list(_CANONICAL_SET), scorer=fuzz.ratio, score_cutoff=82
                )
                if match:
                    found.add(match[0])

    return sorted(found)


# ── Public normalize helper (used by matching.py & llm_parser.py) ─────────────
def normalize_skill_list(skills: List[str]) -> List[str]:
    """Normalize a list of raw skill strings to canonical form. Removes None results."""
    seen: set[str] = set()
    result = []
    for s in skills:
        canon = normalize_skill(s, use_embeddings=True)
        if canon and canon not in seen:
            seen.add(canon)
            result.append(canon)
    return sorted(result)
