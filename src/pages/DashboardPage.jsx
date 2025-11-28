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
  const [reportDateFrom, setReportDateFrom] = useState('');
  const [reportDateTo, setReportDateTo] = useState('');
  const [selectedSearchStudent, setSelectedSearchStudent] = useState(null);

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
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.title}>
          የፍኖተ ሎዛ ቅድስት ማርያም ቤተ ክርስቲያን መራሔ ጽድቅ ሰንበት ትምህርት ቤት አቴንዳንስ
        </h1>
      </header>

      <div style={styles.toolbar}>
        <input
          type="text"
          placeholder="🔍 Search by name, roll, or phone..."
          value={searchTerm}
          onChange={(evt) => setSearchTerm(evt.target.value)}
          style={styles.searchInput}
        />
        <input
          type="date"
          value={selectedDate}
          onChange={(evt) => setSelectedDate(evt.target.value)}
          style={styles.dateInput}
        />
      </div>

      {globalSearchHits.length > 0 && (
        <div style={styles.searchResults}>
          <div style={styles.searchHeader}>
            <strong>Search results</strong>
            <span style={styles.badge}>{globalSearchHits.length} matches</span>
          </div>
          {globalSearchHits.map((student) => {
            const status = attendance[student.id]?.[selectedDate];
            return (
              <div
                key={student.id}
                style={styles.resultItem}
                onClick={() => setSelectedSearchStudent(student)}
              >
                <div style={{ cursor: 'pointer', flex: 1 }}>
                  <strong>{student.name}</strong>
                  <div style={styles.meta}>
                    {student.rollNumber} · {resolveClassLabel(student.classId)}
                  </div>
                  <div style={styles.meta}>{student.phone}</div>
                </div>
                <div style={styles.buttonGroup}>
                  {statusOptions.map((option) => (
                    <button
                      key={option.code}
                      onClick={(e) => {
                        e.stopPropagation();
                        markAttendance(student.id, option.code);
                      }}
                      style={{
                        ...styles.button,
                        ...(status === option.code ? styles.buttonActive : {}),
                      }}
                    >
                      {option.code}
                    </button>
                  ))}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      clearAttendance(student.id);
                    }}
                    style={styles.buttonDanger}
                  >
                    Undo
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selectedSearchStudent && (
        <div style={styles.modal}>
          <div style={styles.modalContent}>
            <div style={styles.modalHeader}>
              <h2 style={styles.modalTitle}>Student Details</h2>
              <button
                onClick={() => setSelectedSearchStudent(null)}
                style={styles.closeButton}
              >
                Close
              </button>
            </div>
            <div style={styles.detailsBox}>
              <div style={styles.detailRow}>
                <strong>Roll Number:</strong> {selectedSearchStudent.rollNumber}
              </div>
              <div style={styles.detailRow}>
                <strong>Name:</strong> {selectedSearchStudent.name}
              </div>
              <div style={styles.detailRow}>
                <strong>Class:</strong> {resolveClassLabel(selectedSearchStudent.classId)}
              </div>
              <div style={styles.detailRow}>
                <strong>Age:</strong> {selectedSearchStudent.age}
              </div>
              <div style={styles.detailRow}>
                <strong>Phone:</strong> {selectedSearchStudent.phone}
              </div>
              <div style={styles.detailRow}>
                <strong>Alt Phone:</strong> {selectedSearchStudent.altPhone}
              </div>
            </div>
            <button
              onClick={() => startEdit(selectedSearchStudent)}
              style={styles.buttonPrimary}
            >
              Edit Student
            </button>
          </div>
        </div>
      )}

      <div style={styles.actionBar}>
        {ACTIONS.map((action) => (
          <button
            key={action.id}
            onClick={() => setActiveView(action.id)}
            style={{
              ...styles.actionButton,
              ...(activeView === action.id ? styles.actionButtonActive : {}),
            }}
          >
            <div style={styles.actionLabel}>{action.label}</div>
            <div style={styles.actionCopy}>{action.copy}</div>
          </button>
        ))}
      </div>

      <div style={styles.content}>
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
            allStudents={students}
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
            reportDateFrom={reportDateFrom}
            reportDateTo={reportDateTo}
            onDateFromChange={setReportDateFrom}
            onDateToChange={setReportDateTo}
          />
        )}
      </div>

      {editDraft && (
        <div style={styles.modal}>
          <div style={styles.modalContent}>
            <div style={styles.modalHeader}>
              <h2 style={styles.modalTitle}>
                {editDraft.name ? 'Edit student' : 'Add new student'}
              </h2>
              <button
                onClick={() => setEditDraft(null)}
                style={styles.closeButton}
              >
                Close
              </button>
            </div>

            <form onSubmit={handleEditSubmit} style={styles.form}>
              <label style={styles.label}>
                Full name
                <input
                  type="text"
                  name="name"
                  value={editDraft.name}
                  onChange={handleEditChange}
                  required
                  style={styles.input}
                />
              </label>

              <label style={styles.label}>
                Roll number
                <input
                  type="number"
                  name="rollNumber"
                  value={editDraft.rollNumber}
                  onChange={handleEditChange}
                  style={styles.input}
                />
              </label>

              <label style={styles.label}>
                Class
                <select
                  name="classId"
                  value={editDraft.classId}
                  onChange={handleEditChange}
                  style={styles.input}
                >
                  {CLASS_CORRIDOR.map((klass) => (
                    <option key={klass.id} value={klass.id}>
                      {klass.label}
                    </option>
                  ))}
                </select>
              </label>

              <label style={styles.label}>
                Age
                <input
                  type="number"
                  name="age"
                  value={editDraft.age}
                  onChange={handleEditChange}
                  style={styles.input}
                />
              </label>

              <label style={styles.label}>
                Phone
                <input
                  type="tel"
                  name="phone"
                  value={editDraft.phone}
                  onChange={handleEditChange}
                  style={styles.input}
                />
              </label>

              <label style={styles.label}>
                Additional phone
                <input
                  type="tel"
                  name="altPhone"
                  value={editDraft.altPhone}
                  onChange={handleEditChange}
                  style={styles.input}
                />
              </label>

              <div style={styles.buttonGroup}>
                <button
                  type="button"
                  onClick={() => setEditDraft(null)}
                  style={styles.buttonSecondary}
                >
                  Cancel
                </button>
                <button type="submit" style={styles.buttonPrimary}>
                  Save changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {toast && <div style={styles.toast}>{toast}</div>}
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
  allStudents,
}) => {
  const [query, setQuery] = useState('');
  const [classStudents, setClassStudents] = useState([]);
  const [draggedStudent, setDraggedStudent] = useState(null);

  useEffect(() => {
    setClassStudents(students);
  }, [students]);

  const visibleStudents = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return classStudents;
    return classStudents.filter((student) => {
      const haystack = `${student.rollNumber} ${student.name} ${student.phone} ${student.altPhone}`.toLowerCase();
      return haystack.includes(trimmed);
    });
  }, [classStudents, query]);

  const handleDragStart = (index) => {
    setDraggedStudent(index);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDrop = (index) => {
    if (draggedStudent === null || draggedStudent === index) return;
    const newList = [...classStudents];
    const [draggedItem] = newList.splice(draggedStudent, 1);
    newList.splice(index, 0, draggedItem);
    setClassStudents(newList);
    setDraggedStudent(null);
  };

  const deleteAllStudents = () => {
    if (!window.confirm('Are you sure you want to delete ALL students in this class? This action cannot be undone.')) {
      return;
    }
    classStudents.forEach((student) => onDelete(student.id));
    setClassStudents([]);
  };

  const downloadClassList = (format) => {
    if (format === 'excel') {
      const rows = classStudents.map((student) => ({
        Roll: student.rollNumber,
        Name: student.name,
        Age: student.age,
        Phone: student.phone,
        'Alt Phone': student.altPhone,
        Class: resolveClassLabel(selectedClass),
      }));
      const sheet = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        wb,
        sheet,
        resolveClassLabel(selectedClass),
      );
      XLSX.writeFile(wb, `class-list-${selectedClass}.xlsx`);
    } else if (format === 'pdf') {
      window.print();
    }
  };

  return (
    <div style={styles.section}>
      <div style={styles.classGrid}>
        {CLASS_CORRIDOR.map((klass) => {
          const isActive = klass.id === selectedClass;
          return (
            <button
              key={klass.id}
              onClick={() => onSelectClass(isActive ? null : klass.id)}
              style={{
                ...styles.classButton,
                ...(isActive ? styles.classButtonActive : {}),
              }}
            >
              <div style={styles.classLabel}>{klass.label}</div>
              <div style={styles.classDesc}>{klass.description}</div>
            </button>
          );
        })}
      </div>

      <button onClick={onAdd} style={styles.addButton}>
        + Add student
      </button>

      {selectedClass && (
        <>
          <input
            type="text"
            placeholder="Filter by name, roll, or phone..."
            value={query}
            onChange={(evt) => setQuery(evt.target.value)}
            style={styles.searchInput}
          />

          {classStudents.length > 0 && (
            <div style={styles.downloadButtonGroup}>
              <button
                onClick={() => downloadClassList('excel')}
                style={styles.buttonSecondary}
              >
                Download as Excel
              </button>
              <button
                onClick={() => downloadClassList('pdf')}
                style={styles.buttonSecondary}
              >
                Download as PDF
              </button>
            </div>
          )}

          <table style={styles.table}>
            <thead>
              <tr style={styles.tableHeader}>
                <th style={styles.th}>Roll</th>
                <th style={styles.th}>Name</th>
                <th style={styles.th}>Age</th>
                <th style={styles.th}>Phones</th>
                <th style={styles.th}>Attendance</th>
                <th style={styles.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleStudents.map((student, idx) => {
                const status = attendance[student.id]?.[selectedDate];
                return (
                  <tr
                    key={student.id}
                    style={{
                      ...styles.tableRow,
                      ...(draggedStudent === idx ? { opacity: 0.5 } : {}),
                    }}
                    draggable
                    onDragStart={() => handleDragStart(idx)}
                    onDragOver={handleDragOver}
                    onDrop={() => handleDrop(idx)}
                  >
                    <td style={styles.td}>{student.rollNumber}</td>
                    <td
                      style={{
                        ...styles.td,
                        cursor: 'grab',
                        fontWeight: 'bold',
                      }}
                    >
                      {student.name}
                    </td>
                    <td style={styles.td}>{student.age}</td>
                    <td style={styles.td}>
                      <div>{student.phone}</div>
                      {student.altPhone && <div>{student.altPhone}</div>}
                    </td>
                    <td style={styles.td}>
                      <div style={styles.buttonGroup}>
                        {statusOptions.map((option) => (
                          <button
                            key={option.code}
                            onClick={() => onMark(student.id, option.code)}
                            style={{
                              ...styles.button,
                              ...(status === option.code ? styles.buttonActive : {}),
                            }}
                          >
                            {option.code}
                          </button>
                        ))}
                        <button
                          onClick={() => onClear(student.id)}
                          style={styles.buttonDanger}
                        >
                          Undo
                        </button>
                      </div>
                    </td>
                    <td style={styles.td}>
                      <div style={styles.buttonGroup}>
                        <button
                          onClick={() => onEdit(student)}
                          style={styles.buttonSecondary}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => onDelete(student.id)}
                          style={styles.buttonDanger}
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {classStudents.length > 0 && (
            <div style={styles.deleteAllContainer}>
              <button
                onClick={deleteAllStudents}
                style={styles.buttonDeleteAll}
              >
                Delete all students in this class
              </button>
            </div>
          )}
        </>
      )}
    </div>
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
  <div style={styles.section}>
    <h2 style={styles.sectionTitle}>Excel upload</h2>
    <p>
      Preview parsed rows before saving to Supabase. Destination class:{' '}
      <strong>{resolveClassLabel(uploadClass)}</strong>
    </p>

    <div style={styles.formGroup}>
      <label>
        Upload to class:
        <select
          value={uploadClass}
          onChange={(evt) => onSelectClass(evt.target.value)}
          style={styles.input}
        >
          {CLASS_CORRIDOR.map((klass) => (
            <option key={klass.id} value={klass.id}>
              Upload to {klass.label}
            </option>
          ))}
        </select>
      </label>

      <label>
        Upload Excel
        <input
          type="file"
          accept=".xlsx,.xls"
          onChange={onFile}
          style={styles.input}
        />
      </label>
    </div>

    {preview.length > 0 && (
      <>
        <table style={styles.table}>
          <thead>
            <tr style={styles.tableHeader}>
              <th style={styles.th}>Roll</th>
              <th style={styles.th}>Name</th>
              <th style={styles.th}>Class</th>
              <th style={styles.th}>Age</th>
              <th style={styles.th}>Phone</th>
              <th style={styles.th}>Alt phone</th>
            </tr>
          </thead>
          <tbody>
            {preview.map((student) => (
              <tr key={student.id} style={styles.tableRow}>
                <td style={styles.td}>{student.rollNumber}</td>
                <td style={styles.td}>{student.name}</td>
                <td style={styles.td}>{resolveClassLabel(student.classId)}</td>
                <td style={styles.td}>{student.age}</td>
                <td style={styles.td}>{student.phone}</td>
                <td style={styles.td}>{student.altPhone}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={styles.buttonGroup}>
          <button onClick={onDiscard} style={styles.buttonSecondary}>
            Discard
          </button>
          <button onClick={onCommit} style={styles.buttonPrimary}>
            Save to roster
          </button>
        </div>
      </>
    )}
  </div>
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
    <div style={styles.section}>
      <h2 style={styles.sectionTitle}>Attendance history</h2>
      <p>Choose a class and search by student, roll, or phone.</p>

      <label style={styles.label}>
        Class:
        <select
          value={historyClass}
          onChange={(evt) => onSelectClass(evt.target.value)}
          style={styles.input}
        >
          {CLASS_CORRIDOR.map((klass) => (
            <option key={klass.id} value={klass.id}>
              {klass.label}
            </option>
          ))}
        </select>
      </label>

      <input
        type="text"
        placeholder="Search by name, roll, or phone..."
        value={query}
        onChange={(evt) => setQuery(evt.target.value)}
        style={styles.searchInput}
      />

      {filteredRows.length === 0 ? (
        <p>No students in this class yet.</p>
      ) : allDates.length === 0 ? (
        <p>No attendance has been recorded yet.</p>
      ) : (
        <>
          <button
            onClick={() => setShowExport((prev) => !prev)}
            style={styles.buttonSecondary}
          >
            Export
          </button>

          {showExport && (
            <div style={styles.buttonGroup}>
              <button
                onClick={() => window.print()}
                style={styles.buttonSecondary}
              >
                PDF
              </button>
              <button
                onClick={() =>
                  exportHistoryExcel(filteredRows, historyClass, allDates)
                }
                style={styles.buttonSecondary}
              >
                Excel
              </button>
            </div>
          )}

          <div style={styles.tableContainer}>
            <table style={styles.table}>
              <thead>
                <tr style={styles.tableHeader}>
                  <th style={styles.th}>Student</th>
                  <th style={styles.th}>Phones</th>
                  {allDates.map((date) => (
                    <th key={date} style={styles.th}>
                      {humanDate(date)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.map(({ student, records }) => {
                  const recordMap = Object.fromEntries(records);
                  return (
                    <tr key={student.id} style={styles.tableRow}>
                      <td style={styles.td}>
                        <strong>{student.rollNumber}. {student.name}</strong>
                      </td>
                      <td style={styles.td}>
                        <div>{student.phone}</div>
                        {student.altPhone && <div>{student.altPhone}</div>}
                      </td>
                      {allDates.map((date) => (
                        <td key={date} style={styles.td}>
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
    </div>
  );
};

const ReportsSection = ({
  students,
  attendance,
  reportClass,
  onSelectClass,
  reportDateFrom,
  reportDateTo,
  onDateFromChange,
  onDateToChange,
}) => {
  const [focusedTab, setFocusedTab] = useState('summary');
  const [showExport, setShowExport] = useState(false);

  const report = useMemo(() => {
    return buildClassReport(
      students,
      attendance,
      reportClass,
      reportDateFrom,
      reportDateTo
    );
  }, [students, attendance, reportClass, reportDateFrom, reportDateTo]);

  return (
    <div style={styles.section}>
      <h2 style={styles.sectionTitle}>Class reports</h2>
      <p>
        Overview of presence, absence, and permission for{' '}
        <strong>{resolveClassLabel(reportClass)}</strong>.
      </p>

      <label style={styles.label}>
        Class:
        <select
          value={reportClass}
          onChange={(evt) => onSelectClass(evt.target.value)}
          style={styles.input}
        >
          {CLASS_CORRIDOR.map((klass) => (
            <option key={klass.id} value={klass.id}>
              {klass.label}
            </option>
          ))}
        </select>
      </label>

      <div style={styles.dateRangeContainer}>
        <label style={styles.label}>
          From:
          <input
            type="date"
            value={reportDateFrom}
            onChange={(evt) => onDateFromChange(evt.target.value)}
            style={styles.input}
          />
        </label>
        <label style={styles.label}>
          To:
          <input
            type="date"
            value={reportDateTo}
            onChange={(evt) => onDateToChange(evt.target.value)}
            style={styles.input}
          />
        </label>
      </div>

      {report.totalStudentDays === 0 ? (
        <p>
          No attendance records yet for this class{' '}
          {reportDateFrom || reportDateTo
            ? `in the selected date range`
            : ''}. Start marking P / PR in the dashboard.
        </p>
      ) : (
        <>
          <button
            onClick={() => setShowExport((prev) => !prev)}
            style={styles.buttonSecondary}
          >
            Export
          </button>

          {showExport && (
            <div style={styles.buttonGroup}>
              <button
                onClick={() => window.print()}
                style={styles.buttonSecondary}
              >
                PDF
              </button>
              <button
                onClick={() => exportAbsentExcel(report, reportClass)}
                style={styles.buttonSecondary}
              >
                Excel
              </button>
            </div>
          )}

          <div style={styles.statsBox}>
            <p>
              <strong>{report.uniqueDays}</strong> days of attendance taken for{' '}
              <strong>{report.rosterSize}</strong> students (
              <strong>{report.totalStudentDays}</strong> records){' '}
              {reportDateFrom || reportDateTo ? 'in selected date range' : ''}
            </p>
          </div>

          <div style={styles.statsGrid}>
            <div style={styles.stat}>
              <div style={styles.statLabel}>Present</div>
              <div style={styles.statValue}>
                {report.counts.P} ({report.percentages.P}%)
              </div>
            </div>
            <div style={styles.stat}>
              <div style={styles.statLabel}>Permission</div>
              <div style={styles.statValue}>
                {report.counts.PR} ({report.percentages.PR}%)
              </div>
            </div>
            <button
              onClick={() => setFocusedTab('absent')}
              style={{...styles.stat, cursor: 'pointer'}}
            >
              <div style={styles.statLabel}>Absent</div>
              <div style={styles.statValue}>
                {report.counts.A} ({report.percentages.A}%)
              </div>
            </button>
          </div>

          {focusedTab === 'absent' && (
            <div style={styles.absentSection}>
              <h3 style={styles.subTitle}>Absent students</h3>
              {report.absentDetails.length === 0 ? (
                <p>No absences recorded yet.</p>
              ) : (
                <table style={styles.table}>
                  <thead>
                    <tr style={styles.tableHeader}>
                      <th style={styles.th}>Roll</th>
                      <th style={styles.th}>Student</th>
                      <th style={styles.th}>Phones</th>
                      <th style={styles.th}>Days absent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.absentDetails.map((item) => (
                      <tr key={item.student.id} style={styles.tableRow}>
                        <td style={styles.td}>{item.student.rollNumber}</td>
                        <td style={styles.td}>{item.student.name}</td>
                        <td style={styles.td}>
                          <div>{item.student.phone}</div>
                          {item.student.altPhone && (
                            <div>{item.student.altPhone}</div>
                          )}
                        </td>
                        <td style={styles.td}>
                          {item.dates.map((date) => humanDate(date)).join(', ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </>
      )}
    </div>
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

const buildClassReport = (
  students,
  attendance,
  classId,
  dateFrom = '',
  dateTo = ''
) => {
  const roster = students.filter((student) => student.classId === classId);
  const counts = { P: 0, A: 0, PR: 0 };
  const dateSet = new Set();
  const absentDetailsMap = {};

  // <CHANGE> Calculate absent students automatically - if no P or PR mark, they're absent by default
  roster.forEach((student) => {
    const records = attendance[student.id] || {};
    
    // Get all dates for this student within the date range
    const studentDates = Object.entries(records)
      .filter(([date]) => {
        if (dateFrom && date < dateFrom) return false;
        if (dateTo && date > dateTo) return false;
        return true;
      });

    if (studentDates.length === 0) return;

    studentDates.forEach(([date, status]) => {
      dateSet.add(date);
      
      // If student has P or PR, count it
      if (status === 'P' || status === 'PR') {
        counts[status] += 1;
      } else {
        // Otherwise, count as absent by default
        counts.A += 1;
        if (!absentDetailsMap[student.id]) {
          absentDetailsMap[student.id] = { student, dates: [] };
        }
        absentDetailsMap[student.id].dates.push(date);
      }
    });
  });

  // Also add students who have NO attendance records for any date in the range as absent
  const allDatesInRange = Array.from(dateSet);
  roster.forEach((student) => {
    const records = attendance[student.id] || {};
    allDatesInRange.forEach((date) => {
      if (!records[date]) {
        // No record for this date = absent
        counts.A += 1;
        if (!absentDetailsMap[student.id]) {
          absentDetailsMap[student.id] = { student, dates: [] };
        }
        if (!absentDetailsMap[student.id].dates.includes(date)) {
          absentDetailsMap[student.id].dates.push(date);
        }
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
    'Days Absent': item.dates.map(d => humanDate(d)).join(', '),
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

// ... styles object ...
const styles = {
  container: {
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '20px',
    fontFamily: 'Arial, sans-serif',
  },
  header: {
    textAlign: 'center',
    marginBottom: '20px',
  },
  title: {
    fontSize: '20px',
    fontWeight: 'bold',
    margin: '0 0 5px 0',
  },
  subtitle: {
    fontSize: '14px',
    color: '#666',
    margin: '0',
  },
  toolbar: {
    display: 'flex',
    gap: '10px',
    marginBottom: '20px',
  },
  searchInput: {
    flex: 1,
    padding: '10px',
    border: '1px solid #ddd',
    borderRadius: '4px',
  },
  dateInput: {
    padding: '10px',
    border: '1px solid #ddd',
    borderRadius: '4px',
  },
  searchResults: {
    backgroundColor: '#f9f9f9',
    border: '1px solid #ddd',
    borderRadius: '4px',
    padding: '15px',
    marginBottom: '20px',
  },
  searchHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '10px',
  },
  badge: {
    backgroundColor: '#e3f2fd',
    color: '#1976d2',
    padding: '4px 8px',
    borderRadius: '12px',
    fontSize: '12px',
    fontWeight: 'bold',
  },
  resultItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px',
    borderBottom: '1px solid #eee',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  },
  meta: {
    fontSize: '12px',
    color: '#999',
    marginTop: '4px',
  },
  buttonGroup: {
    display: 'flex',
    gap: '5px',
  },
  downloadButtonGroup: {
    display: 'flex',
    gap: '10px',
    marginBottom: '15px',
  },
  button: {
    padding: '6px 10px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    cursor: 'pointer',
    backgroundColor: '#fff',
    fontSize: '12px',
  },
  buttonActive: {
    backgroundColor: '#4caf50',
    color: '#fff',
    borderColor: '#4caf50',
  },
  buttonDanger: {
    padding: '6px 10px',
    border: '1px solid #ff6b6b',
    borderRadius: '4px',
    cursor: 'pointer',
    backgroundColor: '#fff',
    color: '#ff6b6b',
    fontSize: '12px',
  },
  buttonSmall: {
    padding: '4px 8px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    cursor: 'pointer',
    backgroundColor: '#fff',
    fontSize: '12px',
  },
  buttonDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  buttonPrimary: {
    padding: '10px 20px',
    border: 'none',
    borderRadius: '4px',
    backgroundColor: '#4caf50',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 'bold',
  },
  buttonSecondary: {
    padding: '10px 20px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    backgroundColor: '#fff',
    cursor: 'pointer',
    fontSize: '14px',
  },
  buttonDeleteAll: {
    padding: '12px 20px',
    border: '2px solid #ff6b6b',
    borderRadius: '4px',
    backgroundColor: '#fff3f3',
    color: '#ff6b6b',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 'bold',
    marginTop: '20px',
  },
  deleteAllContainer: {
    textAlign: 'center',
    padding: '20px 0',
    borderTop: '1px solid #eee',
  },
  actionBar: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: '10px',
    marginBottom: '20px',
  },
  actionButton: {
    padding: '15px',
    border: '1px solid #ddd',
    borderRadius: '8px',
    backgroundColor: '#fff',
    cursor: 'pointer',
    textAlign: 'left',
  },
  actionButtonActive: {
    backgroundColor: '#1976d2',
    color: '#fff',
    borderColor: '#1976d2',
  },
  actionLabel: {
    fontWeight: 'bold',
    fontSize: '14px',
  },
  actionCopy: {
    fontSize: '12px',
    marginTop: '5px',
    opacity: 0.7,
  },
  content: {
    backgroundColor: '#fff',
    border: '1px solid #ddd',
    borderRadius: '8px',
    padding: '20px',
  },
  section: {
    marginTop: '20px',
  },
  sectionTitle: {
    fontSize: '18px',
    fontWeight: 'bold',
    marginBottom: '10px',
  },
  subTitle: {
    fontSize: '16px',
    fontWeight: 'bold',
    marginBottom: '10px',
  },
  classGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
    gap: '10px',
    marginBottom: '20px',
  },
  classButton: {
    padding: '15px',
    border: '2px solid #ddd',
    borderRadius: '8px',
    backgroundColor: '#fff',
    cursor: 'pointer',
    textAlign: 'center',
  },
  classButtonActive: {
    backgroundColor: '#1976d2',
    color: '#fff',
    borderColor: '#1976d2',
  },
  classLabel: {
    fontWeight: 'bold',
    fontSize: '16px',
  },
  classDesc: {
    fontSize: '12px',
    marginTop: '5px',
    opacity: 0.7,
  },
  addButton: {
    padding: '10px 20px',
    border: '2px dashed #1976d2',
    borderRadius: '4px',
    backgroundColor: '#fff',
    color: '#1976d2',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 'bold',
    marginBottom: '20px',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    marginTop: '15px',
  },
  tableContainer: {
    overflowX: 'auto',
    marginTop: '15px',
  },
  tableHeader: {
    backgroundColor: '#f5f5f5',
  },
  th: {
    padding: '10px',
    textAlign: 'left',
    fontWeight: 'bold',
    borderBottom: '2px solid #ddd',
    fontSize: '12px',
  },
  tableRow: {
    borderBottom: '1px solid #eee',
  },
  td: {
    padding: '10px',
    fontSize: '12px',
  },
  label: {
    display: 'block',
    marginBottom: '10px',
    fontSize: '14px',
    fontWeight: 'bold',
  },
  input: {
    width: '100%',
    padding: '8px',
    marginTop: '5px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '14px',
  },
  formGroup: {
    marginBottom: '20px',
  },
  dateRangeContainer: {
    display: 'flex',
    gap: '20px',
    marginBottom: '20px',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '15px',
  },
  modal: {
    position: 'fixed',
    top: '0',
    left: '0',
    right: '0',
    bottom: '0',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: '1000',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: '8px',
    padding: '20px',
    maxWidth: '500px',
    width: '90%',
    maxHeight: '80vh',
    overflowY: 'auto',
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px',
  },
  modalTitle: {
    fontSize: '18px',
    fontWeight: 'bold',
    margin: '0',
  },
  closeButton: {
    padding: '6px 10px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    backgroundColor: '#fff',
    cursor: 'pointer',
    fontSize: '12px',
  },
  detailsBox: {
    backgroundColor: '#f9f9f9',
    padding: '15px',
    borderRadius: '4px',
    marginBottom: '15px',
  },
  detailRow: {
    padding: '8px 0',
    borderBottom: '1px solid #eee',
  },
  statsBox: {
    backgroundColor: '#f9f9f9',
    padding: '15px',
    borderRadius: '4px',
    marginTop: '15px',
    marginBottom: '15px',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
    gap: '10px',
    marginTop: '15px',
  },
  stat: {
    backgroundColor: '#f9f9f9',
    padding: '15px',
    borderRadius: '4px',
    textAlign: 'center',
    border: '1px solid #ddd',
  },
  statLabel: {
    fontSize: '12px',
    fontWeight: 'bold',
    color: '#666',
  },
  statValue: {
    fontSize: '20px',
    fontWeight: 'bold',
    marginTop: '5px',
  },
  absentSection: {
    marginTop: '20px',
    padding: '15px',
    backgroundColor: '#f9f9f9',
    borderRadius: '4px',
  },
  toast: {
    position: 'fixed',
    bottom: '20px',
    right: '20px',
    backgroundColor: '#4caf50',
    color: '#fff',
    padding: '15px 20px',
    borderRadius: '4px',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)',
    zIndex: '2000',
  },
};

export default DashboardPage;

