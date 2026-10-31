-- =====================================================================
--  OPTIONAL sample data for a first test. Run after schema.sql.
--  Remove it later with the "cleanup" block at the bottom.
-- =====================================================================

insert into public.job_functions (name, sort_order) values
  ('Process Operator', 1), ('Maintenance Technician', 2), ('Electrical Technician', 3),
  ('HSE Advisor', 4), ('Supervisor', 5), ('Office / Admin', 6)
on conflict (name) do nothing;

insert into public.courses (abbreviation, name, category, validity_months, delivery_method, duration_hours, sort_order) values
  ('GSI',  'General Safety Induction',  'Induction', null, 'Classroom', 8,  1),
  ('H2S',  'H2S Awareness',             'HSE',       24,   'Classroom', 4,  2),
  ('PTW',  'Permit to Work — Receiver', 'HSE',       24,   'Blended',   8,  3),
  ('BA',   'Breathing Apparatus',       'HSE',       36,   'Practical', 8,  4),
  ('CSE',  'Confined Space Entry',      'HSE',       36,   'Practical', 16, 5),
  ('LOTO', 'Lock-out / Tag-out',        'Technical', 24,   'Classroom', 4,  6),
  ('FA',   'First Aid at Work',         'HSE',       36,   'Practical', 24, 7),
  ('WAH',  'Working at Height',         'HSE',       24,   'Practical', 8,  8),
  ('FW',   'Fire Warden',               'HSE',       24,   'Classroom', 4,  9)
on conflict (abbreviation) do nothing;

-- Matrix: job function name, course abbreviation
insert into public.training_matrix (job_function_id, course_id)
select j.id, c.id
from (values
  ('Process Operator','GSI'),('Process Operator','H2S'),('Process Operator','PTW'),('Process Operator','BA'),('Process Operator','CSE'),
  ('Maintenance Technician','GSI'),('Maintenance Technician','H2S'),('Maintenance Technician','PTW'),('Maintenance Technician','CSE'),('Maintenance Technician','LOTO'),('Maintenance Technician','WAH'),
  ('Electrical Technician','GSI'),('Electrical Technician','H2S'),('Electrical Technician','LOTO'),('Electrical Technician','WAH'),
  ('HSE Advisor','GSI'),('HSE Advisor','H2S'),('HSE Advisor','PTW'),('HSE Advisor','FA'),
  ('Supervisor','GSI'),('Supervisor','H2S'),('Supervisor','PTW'),('Supervisor','BA'),('Supervisor','LOTO'),
  ('Office / Admin','GSI'),('Office / Admin','FA')
) as m(fn, abbr)
join public.job_functions j on j.name = m.fn
join public.courses c on c.abbreviation = m.abbr
on conflict do nothing;

insert into public.personnel (employee_no, full_name, position, job_function_id, department, section, employer)
select v.emp, v.name, v.pos, j.id, v.dept, v.sec, v.employer
from (values
  ('SAMPLE-001','Sample Person One','Senior Process Technician','Process Operator','Operations','Train 4','Company'),
  ('SAMPLE-002','Sample Person Two','Mechanical Technician','Maintenance Technician','Maintenance','Rotating','Company'),
  ('SAMPLE-003','Sample Person Three','Shift Supervisor','Supervisor','Operations','Train 2','Company'),
  ('SAMPLE-004','Sample Person Four','HSE Advisor','HSE Advisor','HSE','Site HSE','Company'),
  ('SAMPLE-005','Sample Person Five','Electrician','Electrical Technician','Maintenance','Electrical','Contractor A')
) as v(emp, name, pos, fn, dept, sec, employer)
join public.job_functions j on j.name = v.fn
on conflict (employee_no) do nothing;

-- Records with dates relative to today so every status shows up
insert into public.training_records (person_id, course_id, completion_date)
select p.id, c.id, (current_date + r.offset_days)
from (values
  ('SAMPLE-001','GSI', -900), ('SAMPLE-001','H2S', -750), ('SAMPLE-001','PTW', -715), ('SAMPLE-001','BA', -300), ('SAMPLE-001','FW', -200),
  ('SAMPLE-002','GSI', -500), ('SAMPLE-002','H2S', -100), ('SAMPLE-002','PTW', -400), ('SAMPLE-002','LOTO', -720),
  ('SAMPLE-003','GSI', -1200),('SAMPLE-003','H2S', -60),  ('SAMPLE-003','PTW', -30),  ('SAMPLE-003','BA', -500), ('SAMPLE-003','LOTO', -90),
  ('SAMPLE-004','GSI', -300), ('SAMPLE-004','H2S', -200), ('SAMPLE-004','PTW', -100), ('SAMPLE-004','FA', -1080),
  ('SAMPLE-005','GSI', -50),  ('SAMPLE-005','LOTO', -40)
) as r(emp, abbr, offset_days)
join public.personnel p on p.employee_no = r.emp
join public.courses c   on c.abbreviation = r.abbr;

-- ---------------------------------------------------------------------
-- Cleanup (run when you're ready for real data):
-- delete from public.personnel where employee_no like 'SAMPLE-%';
-- ---------------------------------------------------------------------
