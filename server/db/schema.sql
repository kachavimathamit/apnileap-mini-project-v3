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
-- School — one college has many schools, each containing
-- multiple departments. A school is headed by its Dean.
-- ------------------------------------------------------------
CREATE TABLE School (
  Sid           SERIAL PRIMARY KEY,
  Sname         VARCHAR(200) NOT NULL,
  School_code   VARCHAR(20),
  Dean_name     VARCHAR(200),
  Dean_contact  VARCHAR(200),
  Cid           INTEGER NOT NULL REFERENCES College(Cid)
);

-- ------------------------------------------------------------
-- Dept — one school has many departments. A department is
-- headed by its HOD (Head of Department) - a distinct role from
-- the school's Dean.
-- ------------------------------------------------------------
CREATE TABLE Dept (
  Did          SERIAL PRIMARY KEY,
  Dname        VARCHAR(200) NOT NULL,
  Dept_code    VARCHAR(20),
  HOD_name     VARCHAR(200),
  HOD_contact  VARCHAR(200),
  Sid          INTEGER NOT NULL REFERENCES School(Sid)
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
-- Academic_year ties a theme to its cohort (e.g. '2026-27') - themes reset
-- every year, so this is what tells two years' worth of themes apart.
-- ------------------------------------------------------------
CREATE TABLE Theme (
  T_id            SERIAL PRIMARY KEY,
  Tname           VARCHAR(200) NOT NULL,
  Academic_year   VARCHAR(10) NOT NULL,
  D_id            INTEGER NOT NULL REFERENCES Dept(Did),
  F_id            INTEGER NOT NULL REFERENCES Faculty(Fid)
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
-- SRN is the registrar-issued identifier (unique) - names alone
-- were never a reliable way to identify a student.
-- ------------------------------------------------------------
CREATE TABLE Student (
  S_id      SERIAL PRIMARY KEY,
  S_name    VARCHAR(200) NOT NULL,
  SRN       VARCHAR(20) NOT NULL UNIQUE,
  Roll_no   VARCHAR(10) NOT NULL,
  Division  VARCHAR(5) NOT NULL,
  Semester  INTEGER NOT NULL,
  A_id      INTEGER NOT NULL REFERENCES Artifact(A_id),
  D_id      INTEGER NOT NULL REFERENCES Dept(Did)
);

-- ------------------------------------------------------------
-- Team-size rule: every artifact's team (its Student rows) is
-- fixed at exactly 4 students - never more, and never fewer once
-- set. A plain CHECK constraint can't count sibling rows, so this
-- is enforced with a trigger: it blocks a 5th student joining a
-- team, and blocks removing anyone once a team is assigned - team
-- composition is meant to be set once and left alone, not varied.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_team_size() RETURNS TRIGGER AS $$
DECLARE
  team_size CONSTANT INTEGER := 4;
  current_count INTEGER;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT COUNT(*) INTO current_count FROM Student WHERE A_id = NEW.A_id;
    IF current_count >= team_size THEN
      RAISE EXCEPTION 'Artifact % already has % students - team size is fixed at %', NEW.A_id, current_count, team_size;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Team membership is fixed once assigned - students cannot be removed from an artifact';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enforce_team_size
  BEFORE INSERT OR DELETE ON Student
  FOR EACH ROW EXECUTE FUNCTION enforce_team_size();
