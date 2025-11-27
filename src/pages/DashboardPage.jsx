import { useMemo, useState, useEffect, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { CLASS_CORRIDOR } from '../data/classConfig';
import { supabase } from '../lib/supabaseClient';

const ACTIONS = [
  { id: 'classes', label: 'Classes', copy: 'View rosters & take attendance' },
  { id: 'upload', label: 'Upload', copy: 'Import Amharic Excel files' },
  { id: 'history', label: 'History', copy: 'Review daily records' },
  { id: 'reports', label: 'Reports', copy: 'Monitor trends & ratios' },
];

const statusOptions = [
  { code: 'P', label: 'Present' },
  { code: 'A', label: 'Absent' },
  { code: 'PR', label: 'Permission' },
];

const DashboardPage = () => {
  const [activeView, setActiveView] = useState('classes');
  const [selectedClass, setSelectedClass] = useState(CLASS_CORRIDOR[0].id);
  const [historyClass, setHistoryClass] = useState(CLASS_CORRIDOR[0].id);
  const [reportClass, setReportClass] = useState(CLASS_CORRIDOR[0].id);
  const [students, setStudents] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDate, setSelectedDate] = useState(() =>
    new Date().toISOString().split('T')[0],
  );
  const [attendance, setAttendance] = useState({});
  const [uploadPreview, setUploadPreview] = useState([]);
  const [uploadClass, setUploadClass] = useState(CLASS_CORRIDOR[0].id);
  const [editDraft, setEditDraft] = useState(null);
  const [toast, setToast] = useState('');
  const [exportSheetName, setExportSheetName] = useState('attendance');

  const fetchStudents = useCallback(async () => {
    const { data, error } = await supabase
      .from('students')
      .select('*')
      .order('roll_number', { ascending: true });

    if (error) {
      console.error('Failed to load students', error);
      setToast('Could not load students from Supabase.');
      return;
    }

    setStudents(data.map(mapStudentFromDb));
  }, []);

  const fetchAttendance = useCallback(async () => {
    const { data, error } = await supabase.from('attendance_records').select('*');
    if (error) {
      console.error('Failed to load attendance', error);
      setToast('Could not load attendance records.');
      return;
    }
    setAttendance(buildAttendanceMap(data));
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(''), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    fetchStudents();
    fetchAttendance();
  }, [fetchStudents, fetchAttendance]);

  const filteredStudents = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return students.filter((student) => {
      const matchesClass = student.classId === selectedClass;
      if (!query) return matchesClass;
      const haystack = `${student.name} ${student.rollNumber} ${student.phone} ${student.altPhone}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [students, selectedClass, searchTerm]);

  const globalSearchHits = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (query.length < 2) return [];
    return students.filter((student) => {
      const haystack = `${student.name} ${student.rollNumber} ${student.phone} ${student.altPhone}`
        .toLowerCase()
        .normalize('NFKD');
      return haystack.includes(query.normalize('NFKD'));
    });
  }, [students, searchTerm]);

  const markAttendance = async (studentId, status) => {
    setAttendance((prev) =>
      updateAttendanceLocal(prev, studentId, selectedDate, status),
    );
    const { error } = await supabase.from('attendance_records').upsert({
      student_id: studentId,
      class_id: selectedClass,
      date: selectedDate,
      status,
    });
    if (error) {
      console.error('Failed to save attendance', error);
      setToast('Could not save attendance.');
      fetchAttendance();
    }
  };

  const clearAttendance = async (studentId) => {
    setAttendance((prev) =>
      removeAttendanceLocal(prev, studentId, selectedDate),
    );
    const { error } = await supabase
      .from('attendance_records')
      .delete()
      .match({ student_id: studentId, date: selectedDate });
    if (error) {
      console.error('Failed to clear attendance', error);
      setToast('Could not clear attendance.');
      fetchAttendance();
    }
  };

  const historyRows = useMemo(() => {
    const roster = students.filter((student) => student.classId === historyClass);
    return roster.map((student) => {
      const records = Object.entries(attendance[student.id] || {}).sort((a, b) =>
        a[0] < b[0] ? 1 : -1,
      );
      return { student, records };
    });
  }, [students, attendance, historyClass]);

  const handleExcelUpload = async (evt) => {
    const file = evt.target.files?.[0];
    if (!file) return;

    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    const [, ...dataRows] = rows;

    const nextStudents = dataRows
      .filter((row) => row[1])
      .map((row, index) => ({
        id: safeId(index),
        rollNumber: Number(row[0]) || index + 1,
        name: row[1]?.toString().trim(),
        classId: uploadClass || matchClass(row[2]),
        age: Number(row[3]) || '',
        phone: row[4]?.toString().trim(),
        altPhone: row[5]?.toString().trim(),
      }));

    setUploadPreview(nextStudents);
    setActiveView('upload');
  };

  const commitUpload = async () => {
    if (!uploadPreview.length) return;
    const payload = uploadPreview.map(mapStudentToDb);
    const { data, error } = await supabase
      .from('students')
      .insert(payload)
      .select();

    if (error) {
      console.error('Failed to save students', error);
      setToast('Save failed. Please try again.');
      return;
    }

    setStudents((prev) => [...prev, ...data.map(mapStudentFromDb)]);
    setUploadPreview([]);
    setToast('Student list saved to Supabase.');
  };

  const handleStudentDelete = async (studentId) => {
    const { error } = await supabase.from('students').delete().eq('id', studentId);
    if (error) {
      console.error('Failed to delete student', error);
      setToast('Unable to delete student.');
      return;
    }
    setStudents((prev) => prev.filter((student) => student.id !== studentId));
    setAttendance((prev) => {
      const next = { ...prev };
      delete next[studentId];
      return next;
    });
    setToast('Student removed from roster.');
  };

  const handleEditChange = (evt) => {
    const { name, value } = evt.target;
    setEditDraft((prev) => ({ ...prev, [name]: value }));
  };

  const handleEditSubmit = async (evt) => {
    evt.preventDefault();
    if (!editDraft) return;
    const payload = mapStudentToDb(editDraft);
    try {
      if (editDraft.id) {
        const { data, error } = await supabase
          .from('students')
          .update(payload)
          .eq('id', editDraft.id)
          .select()
          .single();
        if (error) throw error;
        setStudents((prev) =>
          prev.map((student) =>
            student.id === editDraft.id ? mapStudentFromDb(data) : student,
          ),
        );
      } else {
        const { data, error } = await supabase
          .from('students')
          .insert(payload)
          .select()
          .single();
        if (error) throw error;
        setStudents((prev) => [...prev, mapStudentFromDb(data)]);
      }
      setToast('Student details saved.');
      setEditDraft(null);
    } catch (error) {
      console.error('Failed to save student', error);
      setToast(error.message || 'Could not save student.');
    }
  };

  const startEdit = (student) => setEditDraft(student);

  const addEmptyStudent = () => {
    setEditDraft({
      id: null,
      rollNumber: students.length + 1,
      name: '',
      classId: selectedClass,
      age: '',
      phone: '',
      altPhone: '',
    });
  };

  return (
    <div className="dashboard-page">
      <header className="dashboard-header card">
        <div>
          <h1 className="dashboard-title-am">
            የፍኖተ ሎዛ ቅድስት ማርያም ቤተ ክርስቲያን መራሔ ጽድቅ ሰንበት ትምህርት ቤት
          </h1>
        </div>
        <div className="header-controls header-controls-stacked">
          <input
            className="search-input search-input-wide"
            placeholder="Search by name, roll, or phone"
            value={searchTerm}
            onChange={(evt) => setSearchTerm(evt.target.value)}
          />
          <input
            type="date"
            value={selectedDate}
            onChange={(evt) => setSelectedDate(evt.target.value)}
            className="date-input"
          />
        </div>
      </header>

      {globalSearchHits.length > 0 && (
        <section className="card search-results">
          <header>
            <h3>Search results</h3>
            <p>{globalSearchHits.length} matches</p>
          </header>
          <div className="results-grid">
            {globalSearchHits.map((student) => {
              const status = attendance[student.id]?.[selectedDate];
              return (
                <article key={student.id}>
                  <h4>{student.name}</h4>
                  <p>
                    {student.rollNumber} · {resolveClassLabel(student.classId)}
                  </p>
                  <p>{student.phone}</p>
                  <div className="status-buttons">
                    {statusOptions.map((option) => (
                      <button
                        key={option.code}
                        className={[
                          'status-btn',
                          status === option.code && 'is-selected',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        onClick={() => markAttendance(student.id, option.code)}
                      >
                        {option.code}
                      </button>
                    ))}
                    <button
                      className="link-btn"
                      type="button"
                      onClick={() => clearAttendance(student.id)}
                    >
                      Undo
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      <section className="actions-row">
        {ACTIONS.map((action) => (
          <button
            key={action.id}
            className={['action-card', activeView === action.id && 'is-active']
              .filter(Boolean)
              .join(' ')}
            onClick={() => setActiveView(action.id)}
          >
            <span>{action.label}</span>
            <p>{action.copy}</p>
          </button>
        ))}
      </section>

      <main className="dashboard-content">
        {activeView === 'classes' && (
          <ClassSection
            selectedClass={selectedClass}
            onSelectClass={setSelectedClass}
            students={filteredStudents}
            onMark={markAttendance}
            onClear={clearAttendance}
            attendance={attendance}
            selectedDate={selectedDate}
            onEdit={startEdit}
            onDelete={handleStudentDelete}
            onAdd={addEmptyStudent}
          />
        )}

        {activeView === 'upload' && (
          <UploadSection
            preview={uploadPreview}
            onCommit={commitUpload}
            onDiscard={() => setUploadPreview([])}
            uploadClass={uploadClass}
            onSelectClass={setUploadClass}
            onFile={handleExcelUpload}
          />
        )}

        {activeView === 'history' && (
          <HistorySection
            historyClass={historyClass}
            onSelectClass={setHistoryClass}
            historyRows={historyRows}
          />
        )}

        {activeView === 'reports' && (
          <ReportsSection
            students={students}
            attendance={attendance}
            reportClass={reportClass}
            onSelectClass={setReportClass}
          />
        )}
      </main>

      {editDraft && (
        <aside className="drawer card">
          <form onSubmit={handleEditSubmit}>
            <header>
              <h3>{editDraft.name ? 'Edit student' : 'Add new student'}</h3>
              <button
                type="button"
                className="link-btn"
                onClick={() => setEditDraft(null)}
              >
                Close
              </button>
            </header>
            <label>
              Full name
              <input
                name="name"
                required
                value={editDraft.name}
                onChange={handleEditChange}
                placeholder="ስም"
              />
            </label>
            <label>
              Roll number
              <input
                name="rollNumber"
                type="number"
                value={editDraft.rollNumber}
                onChange={handleEditChange}
              />
            </label>
            <label>
              Class
              <select
                name="classId"
                value={editDraft.classId}
                onChange={handleEditChange}
              >
                {CLASS_CORRIDOR.map((klass) => (
                  <option key={klass.id} value={klass.id}>
                    {klass.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Age
              <input
                name="age"
                type="number"
                value={editDraft.age}
                onChange={handleEditChange}
              />
            </label>
            <label>
              Phone
              <input
                name="phone"
                value={editDraft.phone}
                onChange={handleEditChange}
              />
            </label>
            <label>
              Additional phone
              <input
                name="altPhone"
                value={editDraft.altPhone}
                onChange={handleEditChange}
              />
            </label>
            <footer className="drawer-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setEditDraft(null)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                Save changes
              </button>
            </footer>
          </form>
        </aside>
      )}

      {toast && <div className="toast card">{toast}</div>}
    </div>
  );
};

const ClassSection = ({
  selectedClass,
  onSelectClass,
  students,
  onMark,
  onClear,
  attendance,
  selectedDate,
  onEdit,
  onDelete,
  onAdd,
}) => {
  const [query, setQuery] = useState('');

  const visibleStudents = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return students;
    return students.filter((student) => {
      const haystack = `${student.rollNumber} ${student.name} ${student.phone} ${student.altPhone}`.toLowerCase();
      return haystack.includes(trimmed);
    });
  }, [students, query]);

  return (
    <section className="card class-section">
      <div className="class-grid">
        {CLASS_CORRIDOR.map((klass) => {
          const isActive = klass.id === selectedClass;
          return (
            <button
              key={klass.id}
              className={['class-chip', isActive && 'is-active'].filter(Boolean).join(' ')}
              onClick={() => onSelectClass(isActive ? null : klass.id)}
            >
              <strong>{klass.label}</strong>
              <span>{klass.description}</span>
            </button>
          );
        })}
        <button className="class-chip add-chip" onClick={onAdd}>
          + Add student
        </button>
      </div>

      {selectedClass && (
        <>
          <div className="class-search-row">
            <input
              className="search-input"
              placeholder="Search student, roll, phone"
              value={query}
              onChange={(evt) => setQuery(evt.target.value)}
            />
          </div>

          <div className="table-wrapper">
            <table>
              <tbody>
                {visibleStudents.map((student) => {
                  const status = attendance[student.id]?.[selectedDate];
                  return (
                    <tr key={student.id}>
                      <td>{student.rollNumber}</td>
                      <td>{student.name}</td>
                      <td>{student.age}</td>
                      <td>
                        <span>{student.phone}</span>
                        <small>{student.altPhone}</small>
                      </td>
                      <td>
                        <div className="status-buttons">
                          {statusOptions.map((option) => (
                            <button
                              key={option.code}
                              className={[
                                'status-btn',
                                status === option.code && 'is-selected',
                              ]
                                .filter(Boolean)
                                .join(' ')}
                              onClick={() => onMark(student.id, option.code)}
                            >
                              {option.code}
                            </button>
                          ))}
                          <button
                            className="link-btn"
                            type="button"
                            onClick={() => onClear(student.id)}
                          >
                            Undo
                          </button>
                        </div>
                      </td>
                      <td>
                        <button
                          className="link-btn"
                          type="button"
                          onClick={() => onEdit(student)}
                        >
                          Edit
                        </button>
                        <button
                          className="link-btn danger"
                          type="button"
                          onClick={() => onDelete(student.id)}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
};

const UploadSection = ({
  preview,
  onCommit,
  onDiscard,
  uploadClass,
  onSelectClass,
  onFile,
}) => (
  <section className="card upload-section">
    <header>
      <h3>Excel upload</h3>
      <p>
        Preview parsed rows before saving to Supabase. Destination class:{' '}
        <strong>{resolveClassLabel(uploadClass)}</strong>
      </p>
    </header>
    <div className="upload-controls-row">
      <select
        className="class-select"
        value={uploadClass}
        onChange={(evt) => onSelectClass(evt.target.value)}
      >
        {CLASS_CORRIDOR.map((klass) => (
          <option key={klass.id} value={klass.id}>
            Upload to {klass.label}
          </option>
        ))}
      </select>
      <label className="upload-chip">
        Upload Excel
        <input type="file" accept=".xls,.xlsx" onChange={onFile} />
      </label>
    </div>
    {preview.length > 0 && (
      <>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Roll</th>
                <th>Name</th>
                <th>Class</th>
                <th>Age</th>
                <th>Phone</th>
                <th>Alt phone</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((student) => (
                <tr key={student.id}>
                  <td>{student.rollNumber}</td>
                  <td>{student.name}</td>
                  <td>{resolveClassLabel(student.classId)}</td>
                  <td>{student.age}</td>
                  <td>{student.phone}</td>
                  <td>{student.altPhone}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <footer className="upload-actions">
          <button className="btn btn-secondary" onClick={onDiscard}>
            Discard
          </button>
          <button className="btn btn-primary" onClick={onCommit}>
            Save to roster
          </button>
        </footer>
      </>
    )}
  </section>
);

const HistorySection = ({ historyClass, onSelectClass, historyRows }) => {
  const [query, setQuery] = useState('');
  const [showExport, setShowExport] = useState(false);
  const allDates = Array.from(
    new Set(
      historyRows.flatMap(({ records }) => records.map(([date]) => date)),
    ),
  ).sort();

  const filteredRows = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return historyRows;
    return historyRows.filter(({ student }) => {
      const haystack = `${student.rollNumber} ${student.name} ${student.phone} ${student.altPhone}`.toLowerCase();
      return haystack.includes(trimmed);
    });
  }, [historyRows, query]);

  return (
    <section className="card history-section">
      <header className="history-header">
        <div>
          <h3>Attendance history</h3>
          <p>Choose a class and search by student, roll, or phone.</p>
        </div>
        <div className="header-controls">
          <select
            value={historyClass}
            onChange={(evt) => onSelectClass(evt.target.value)}
          >
            {CLASS_CORRIDOR.map((klass) => (
              <option key={klass.id} value={klass.id}>
                {klass.label}
              </option>
            ))}
          </select>
          <input
            className="search-input"
            placeholder="Search student, roll, phone"
            value={query}
            onChange={(evt) => setQuery(evt.target.value)}
          />
        </div>
      </header>
      {filteredRows.length === 0 ? (
        <p className="muted">No students in this class yet.</p>
      ) : allDates.length === 0 ? (
        <p className="muted">No attendance has been recorded yet.</p>
      ) : (
        <>
          <div className="section-toolbar">
            <button
              type="button"
              className="download-button"
              onClick={() => setShowExport((prev) => !prev)}
            >
              ⬇
            </button>
            {showExport && (
              <div className="download-menu">
                <button
                  type="button"
                  className="download-chip"
                  onClick={() => window.print()}
                >
                  PDF
                </button>
                <button
                  type="button"
                  className="download-chip"
                  onClick={() =>
                    exportHistoryExcel(filteredRows, historyClass, allDates)
                  }
                >
                  Excel
                </button>
              </div>
            )}
          </div>
          <div className="table-wrapper history-table">
            <table>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Phones</th>
                  {allDates.map((date) => (
                    <th key={date}>{humanDate(date)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.map(({ student, records }) => {
                  const recordMap = Object.fromEntries(records);
                  return (
                    <tr key={student.id}>
                      <td>
                        {student.rollNumber}. {student.name}
                      </td>
                      <td>
                        <span>{student.phone}</span>
                        {student.altPhone && <small>{student.altPhone}</small>}
                      </td>
                      {allDates.map((date) => (
                        <td key={date} className="history-cell">
                          {recordMap[date] || '—'}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
};

const ReportsSection = ({ students, attendance, reportClass, onSelectClass }) => {
  const [focusedTab, setFocusedTab] = useState('summary');
  const [showExport, setShowExport] = useState(false);
  const report = useMemo(
    () => buildClassReport(students, attendance, reportClass),
    [students, attendance, reportClass],
  );

  return (
    <section className="card reports-section">
      <header>
        <div>
          <h3>Class reports</h3>
          <p>
            Overview of presence, absence, and permission for{' '}
            <strong>{resolveClassLabel(reportClass)}</strong>.
          </p>
        </div>
        <select
          value={reportClass}
          onChange={(evt) => onSelectClass(evt.target.value)}
        >
          {CLASS_CORRIDOR.map((klass) => (
            <option key={klass.id} value={klass.id}>
              {klass.label}
            </option>
          ))}
        </select>
      </header>

      {report.totalStudentDays === 0 ? (
        <p className="muted">
          No attendance records yet for this class. Start marking P / A / PR in the
          dashboard.
        </p>
      ) : (
        <>
          <div className="section-toolbar">
            <button
              type="button"
              className="download-button"
              onClick={() => setShowExport((prev) => !prev)}
            >
              ⬇
            </button>
            {showExport && (
              <div className="download-menu">
                <button
                  type="button"
                  className="download-chip"
                  onClick={() => window.print()}
                >
                  PDF
                </button>
                <button
                  type="button"
                  className="download-chip"
                  onClick={() => exportAbsentExcel(report, reportClass)}
                >
                  Excel
                </button>
              </div>
            )}
          </div>

          <div className="report-summary">
            <p>
              <strong>{report.uniqueDays}</strong> days of attendance taken for{' '}
              <strong>{report.rosterSize}</strong> students (
              {report.totalStudentDays} records).
            </p>
            <div className="report-badges">
              <span>
                Present: {report.counts.P} ({report.percentages.P}%)
              </span>
              <span>
                Permission: {report.counts.PR} ({report.percentages.PR}%)
              </span>
              <button
                type="button"
                className={[
                  'link-pill',
                  focusedTab === 'absent' && 'link-pill-active',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => setFocusedTab('absent')}
              >
                Absent: {report.counts.A} ({report.percentages.A}%)
              </button>
            </div>
          </div>

          {focusedTab === 'absent' && (
            <div className="report-detail">
              <h4>Absent students</h4>
              {report.absentDetails.length === 0 ? (
                <p className="muted">No absences recorded yet.</p>
              ) : (
                <div className="table-wrapper">
                  <table>
                    <thead>
                      <tr>
                        <th>Roll</th>
                        <th>Student</th>
                        <th>Phones</th>
                        <th>Days absent</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.absentDetails.map((item) => (
                        <tr key={item.student.id}>
                          <td>{item.student.rollNumber}</td>
                          <td>{item.student.name}</td>
                          <td>
                            <span>{item.student.phone}</span>
                            {item.student.altPhone && (
                              <small>{item.student.altPhone}</small>
                            )}
                          </td>
                          <td>
                            {item.dates.map((date) => humanDate(date)).join(', ')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
};

const matchClass = (value) => {
  if (!value) return CLASS_CORRIDOR[0].id;
  const normalized = value.toString().toLowerCase();
  const matched = CLASS_CORRIDOR.find(({ label }) =>
    normalized.includes(label.toLowerCase()),
  );
  if (matched) return matched.id;
  const digit = normalized.match(/\d+/);
  if (digit) {
    const index = Number(digit[0]);
    const fallback = CLASS_CORRIDOR[index] || CLASS_CORRIDOR[0];
    return fallback.id;
  }
  return CLASS_CORRIDOR[0].id;
};

const resolveClassLabel = (classId) =>
  CLASS_CORRIDOR.find((klass) => klass.id === classId)?.label ?? 'Unknown';

const humanDate = (isoDate) =>
  new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(
    new Date(isoDate),
  );

const safeId = (suffix = '') =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `STU-${Date.now()}-${Math.random().toString(16).slice(2)}${suffix}`;

const mapStudentFromDb = (row) => ({
  id: row.id,
  rollNumber: row.roll_number ?? '',
  name: row.full_name ?? '',
  classId: row.class_id,
  age: row.age ?? '',
  phone: row.phone ?? '',
  altPhone: row.alt_phone ?? '',
});

const mapStudentToDb = (student) => ({
  roll_number: student.rollNumber || null,
  full_name: student.name,
  class_id: student.classId,
  age: student.age ? Number(student.age) : null,
  phone: student.phone || null,
  alt_phone: student.altPhone || null,
});

const buildAttendanceMap = (rows) =>
  rows.reduce((acc, row) => {
    if (!row.student_id || !row.date) return acc;
    if (!acc[row.student_id]) acc[row.student_id] = {};
    acc[row.student_id][row.date] = row.status;
    return acc;
  }, {});

const updateAttendanceLocal = (state, studentId, date, status) => {
  const studentHistory = state[studentId] ? { ...state[studentId] } : {};
  studentHistory[date] = status;
  return { ...state, [studentId]: studentHistory };
};

const removeAttendanceLocal = (state, studentId, date) => {
  if (!state[studentId]) return state;
  const studentHistory = { ...state[studentId] };
  delete studentHistory[date];
  const nextState = { ...state };
  if (Object.keys(studentHistory).length) {
    nextState[studentId] = studentHistory;
  } else {
    delete nextState[studentId];
  }
  return nextState;
};

const buildClassReport = (students, attendance, classId) => {
  const roster = students.filter((student) => student.classId === classId);
  const counts = { P: 0, A: 0, PR: 0 };
  const dateSet = new Set();
  const absentDetailsMap = {};

  roster.forEach((student) => {
    const records = attendance[student.id] || {};
    Object.entries(records).forEach(([date, status]) => {
      if (!status) return;
      dateSet.add(date);
      if (counts[status] !== undefined) counts[status] += 1;
      if (status === 'A') {
        if (!absentDetailsMap[student.id]) {
          absentDetailsMap[student.id] = { student, dates: [] };
        }
        absentDetailsMap[student.id].dates.push(date);
      }
    });
  });

  const totalStudentDays = counts.P + counts.A + counts.PR;
  const uniqueDays = dateSet.size;

  const pct = (value) =>
    totalStudentDays === 0 ? 0 : Math.round((value / totalStudentDays) * 100);

  return {
    rosterSize: roster.length,
    uniqueDays,
    totalStudentDays,
    counts,
    percentages: {
      P: pct(counts.P),
      A: pct(counts.A),
      PR: pct(counts.PR),
    },
    absentDetails: Object.values(absentDetailsMap),
  };
};

const exportHistoryExcel = (historyRows, classId, dates) => {
  if (!historyRows.length || !dates.length) return;
  const rows = historyRows.map(({ student, records }) => {
    const recordMap = Object.fromEntries(records);
    const base = {
      Roll: student.rollNumber,
      Name: student.name,
      Phone: student.phone,
      'Alt Phone': student.altPhone,
    };
    dates.forEach((date) => {
      base[date] = recordMap[date] || '';
    });
    return base;
  });
  const sheet = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    sheet,
    resolveClassLabel(classId) || 'History',
  );
  XLSX.writeFile(wb, `history-${classId || 'class'}.xlsx`);
};

const exportAbsentExcel = (report, classId) => {
  if (!report.absentDetails.length) return;
  const rows = report.absentDetails.map((item) => ({
    Roll: item.student.rollNumber,
    Name: item.student.name,
    Phone: item.student.phone,
    'Alt Phone': item.student.altPhone,
    'Days Absent': item.dates.join(', '),
  }));
  const sheet = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    sheet,
    resolveClassLabel(classId) || 'Absent',
  );
  XLSX.writeFile(wb, `absent-${classId || 'class'}.xlsx`);
};

export default DashboardPage;

