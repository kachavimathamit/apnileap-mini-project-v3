-- ============================================================
-- Apnileap Mini Project v3 — database schema
-- Engine: PostgreSQL (Cid uses SERIAL, per spec)
-- ============================================================

-- ------------------------------------------------------------
-- College — the top of the hierarchy (College > School > Dept
-- > Faculty > Theme > Artifact > Student > Result), per the
-- hand-drawn design.
-- ------------------------------------------------------------
CREATE TABLE College (
  Cid           SERIAL PRIMARY KEY,
  College_name  VARCHAR(200) NOT NULL,
  Campus        VARCHAR(100)
);

-- ------------------------------------------------------------
-- School — one college has many schools.
-- ------------------------------------------------------------
CREATE TABLE School (
  Sid     SERIAL PRIMARY KEY,
  Sname   VARCHAR(200) NOT NULL,
  Cid     INTEGER NOT NULL REFERENCES College(Cid)
);

-- ------------------------------------------------------------
-- Dept — one school has many departments.
-- ------------------------------------------------------------
CREATE TABLE Dept (
  Did     SERIAL PRIMARY KEY,
  Dname   VARCHAR(200) NOT NULL,
  Sid     INTEGER NOT NULL REFERENCES School(Sid)
);

-- ------------------------------------------------------------
-- Faculty — one department has many faculty.
-- ------------------------------------------------------------
CREATE TABLE Faculty (
  Fid     SERIAL PRIMARY KEY,
  Fname   VARCHAR(200) NOT NULL,
  Did     INTEGER NOT NULL REFERENCES Dept(Did)
);

-- ------------------------------------------------------------
-- Theme — a faculty member's project theme, within a department.
-- ------------------------------------------------------------
CREATE TABLE Theme (
  T_id    SERIAL PRIMARY KEY,
  Tname   VARCHAR(200) NOT NULL,
  D_id    INTEGER NOT NULL REFERENCES Dept(Did),
  F_id    INTEGER NOT NULL REFERENCES Faculty(Fid)
);

-- ------------------------------------------------------------
-- Artifact — the actual project/deliverable built under a theme.
-- ------------------------------------------------------------
CREATE TABLE Artifact (
  A_id    SERIAL PRIMARY KEY,
  A_name  VARCHAR(200) NOT NULL,
  T_id    INTEGER NOT NULL REFERENCES Theme(T_id)
);

-- ------------------------------------------------------------
-- Student — owns/works on one artifact, within a department.
-- ------------------------------------------------------------
CREATE TABLE Student (
  S_id    SERIAL PRIMARY KEY,
  S_name  VARCHAR(200) NOT NULL,
  A_id    INTEGER NOT NULL REFERENCES Artifact(A_id),
  D_id    INTEGER NOT NULL REFERENCES Dept(Did)
);
