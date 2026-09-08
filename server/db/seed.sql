-- ============================================================
-- College — seed data
-- Names fetched from the existing ApniLeap Mini Project v2
-- database (server/data/portal.db, table institutes).
--
-- KLE Technological University is the one institute split into
-- two campus rows, per instruction. The other four institutes
-- carry straight over as one College row each, using their
-- existing name and city.
-- ============================================================

INSERT INTO College (College_name, Campus) VALUES
  ('KLETech Hubballi Campus', 'Hubballi'),
  ('KLETech Belagavi Campus', 'Belagavi'),
  ('Marathwada Mitra Mandal College of Engineering', 'Pune'),
  ('Rajarambapu Institute of Technology', 'Islampur'),
  ('College of Engineering Pune (COEB/COEP - name to be confirmed)', 'Pune'),
  ('Sangli Institute (official name to be confirmed)', 'Sangli');

-- ============================================================
-- School → Dept → Faculty → Theme → Artifact → Student
-- 5 rows per table, ALL scoped under Cid = 1 (KLETech Hubballi
-- Campus) only — no other college has any of this data yet.
--
-- Kept as 5 parallel, fully-traceable chains (one school, one
-- dept, one faculty, one theme, one artifact, one student per
-- lane) rather than a fan-out, so every row can be followed end
-- to end without ambiguity.
-- ============================================================

INSERT INTO School (Sname, Cid) VALUES
  ('School of Computer Science & Engineering', 1),
  ('School of Electronics & Communication Engineering', 1),
  ('School of Mechanical Engineering', 1),
  ('School of Civil Engineering', 1),
  ('School of Computer Applications', 1);

INSERT INTO Dept (Dname, Sid) VALUES
  ('Computer Science and Engineering', 1),
  ('Electronics and Communication Engineering', 2),
  ('Mechanical Engineering', 3),
  ('Civil Engineering', 4),
  ('Computer Applications', 5);

INSERT INTO Faculty (Fname, Did) VALUES
  ('Prof. Sanjay Hegde', 1),
  ('Prof. Meera Nayak', 2),
  ('Prof. Suresh Patil', 3),
  ('Prof. Anita Deshpande', 4),
  ('Prof. Kiran Joshi', 5);

INSERT INTO Theme (Tname, D_id, F_id) VALUES
  ('Role-Based Workflow Management System', 1, 1),
  ('Multi-Process Search Engine with Persistent Index', 2, 2),
  ('Constraint-Based Timetable Scheduling System', 3, 3),
  ('Transaction-Based Inventory Management System', 4, 4),
  ('Peer-to-Peer File Sharing System', 5, 5);

INSERT INTO Artifact (A_name, T_id) VALUES
  ('Campus Lab Access Control Portal', 1),
  ('Digital Library Search Engine', 2),
  ('Automated Exam Timetable Generator', 3),
  ('Hostel Inventory Management System', 4),
  ('Peer Notes Sharing Network', 5);

INSERT INTO Student (S_name, A_id, D_id) VALUES
  ('Rohan Kulkarni', 1, 1),
  ('Sneha Patil', 2, 2),
  ('Aditya Desai', 3, 3),
  ('Priya Joshi', 4, 4),
  ('Karan Shetty', 5, 5);
