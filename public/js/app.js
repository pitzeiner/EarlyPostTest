// ============================================================
// Early Post Test — SPA Shell, API Client & Auth
// ============================================================

(function () {
  "use strict";

  // ---- API Client ----
  const api = {
    _baseUrl: "",

    _headers() {
      const h = { "Content-Type": "application/json" };
      const token = auth.getToken();
      if (token) h["Authorization"] = "Bearer " + token;
      return h;
    },

    async request(method, path, body) {
      const h = this._headers();
      const opts = { method, headers: h };
      if (body !== undefined) {
        opts.body = JSON.stringify(body);
      } else {
        // Remove Content-Type for requests with no body (e.g. DELETE)
        delete h["Content-Type"];
      }
      const res = await fetch(this._baseUrl + path, opts);
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const err = new Error(data?.message || res.statusText);
        err.status = res.status;
        err.data = data;
        throw err;
      }
      return data;
    },

    get(path) {
      return this.request("GET", path);
    },
    post(path, body) {
      return this.request("POST", path, body);
    },
    put(path, body) {
      return this.request("PUT", path, body);
    },
    patch(path, body) {
      return this.request("PATCH", path, body);
    },
    delete(path) {
      return this.request("DELETE", path);
    },
  };

  // ---- Auth (JWT token management) ----
  const auth = {
    _tokenKey: "ept_token",
    _userKey: "ept_user",

    getToken() {
      return localStorage.getItem(this._tokenKey);
    },

    getUser() {
      const raw = localStorage.getItem(this._userKey);
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    },

    saveSession(token, user) {
      localStorage.setItem(this._tokenKey, token);
      localStorage.setItem(this._userKey, JSON.stringify(user));
    },

    clearSession() {
      localStorage.removeItem(this._tokenKey);
      localStorage.removeItem(this._userKey);
    },

    isAuthenticated() {
      return !!this.getToken();
    },
  };

  // ---- Router ----
  const routes = {
    "/setup": "view-setup",
    "/login": "view-auth",
    "/tasks": "view-tasks",
    "/information": "view-information",
    "/calendar": "view-calendar",
    "/admin": "view-admin",
    "/settings": "view-settings",
  };

  function getHashRoute() {
    const hash = window.location.hash.slice(1) || "/login";
    return hash;
  }

  function navigate(route) {
    window.location.hash = route;
  }

  function showView(viewId) {
    document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
    const el = document.getElementById(viewId);
    if (el) el.classList.remove("hidden");

    // Update nav active state
    document.querySelectorAll(".nav-links a").forEach((a) => {
      a.classList.toggle("active", a.dataset.route && "#/" + a.dataset.route === getHashRoute());
    });
  }

  function onRouteChange() {
    const route = getHashRoute();
    const authenticated = auth.isAuthenticated();

    // Redirect authenticated users away from setup/login
    if (authenticated && route === "/setup") {
      navigate("/tasks");
      return;
    }
    if (authenticated && route === "/login") {
      navigate("/tasks");
      return;
    }

    // Redirect unauthenticated users to login (unless on setup)
    if (!authenticated && route !== "/login" && route !== "/setup") {
      navigate("/login");
      return;
    }

    // Admin route guard
    if ((route === "/admin" || route === "/settings") && auth.getUser()?.role !== "admin") {
      navigate("/tasks");
      return;
    }

    const viewId = routes[route] || "view-auth";
    showView(viewId);

    // Show/hide nav
    const nav = document.getElementById("nav");
    if (authenticated) {
      nav.classList.remove("hidden");
      updateNavVisibility();
    } else {
      nav.classList.add("hidden");
    }
  }

  function updateNavVisibility() {
    const isAdmin = auth.getUser()?.role === "admin";
    document.querySelectorAll(".admin-only").forEach((el) => {
      el.classList.toggle("hidden", !isAdmin);
    });
  }

  // ---- Auth UI ----
  function showError(el, msg) {
    el.textContent = msg;
    el.classList.remove("hidden");
  }

  function hideError(el) {
    el.textContent = "";
    el.classList.add("hidden");
  }

  function initAuthForms() {
    const formRequest = document.getElementById("form-code-request");
    const formVerify = document.getElementById("form-code-verify");
    const requestError = document.getElementById("code-request-error");
    const requestSuccess = document.getElementById("code-request-success");
    const verifyError = document.getElementById("code-verify-error");
    const backToEmail = document.getElementById("back-to-email");
    const verifyEmailDisplay = document.getElementById("verify-email-display");

    let currentEmail = "";

    // Step 1: Request code
    formRequest.addEventListener("submit", async (e) => {
      e.preventDefault();
      hideError(requestError);
      hideError(requestSuccess);
      const btn = formRequest.querySelector("button[type=submit]");
      btn.disabled = true;
      btn.textContent = "Senden…";

      try {
        const fd = new FormData(formRequest);
        currentEmail = (fd.get("email") || "").toString().trim().toLowerCase();
        const data = await api.post("/api/auth/request-code", { email: currentEmail });

        // Show success message and switch to step 2
        if (data.emailSent) {
          verifyEmailDisplay.textContent = currentEmail;
          formRequest.classList.add("hidden");
          formVerify.classList.remove("hidden");
          formVerify.querySelector("input[name=code]").focus();
        } else {
          showError(requestSuccess, data.message || "Code wurde generiert. Bitte Postfach prüfen.");
          requestSuccess.classList.remove("hidden");
        }
      } catch (err) {
        showError(requestError, err.message || "Code-Anfrage fehlgeschlagen");
      } finally {
        btn.disabled = false;
        btn.textContent = "Code senden";
      }
    });

    // Step 2: Verify code
    formVerify.addEventListener("submit", async (e) => {
      e.preventDefault();
      hideError(verifyError);
      const btn = formVerify.querySelector("button[type=submit]");
      btn.disabled = true;
      btn.textContent = "Anmelden…";

      try {
        const fd = new FormData(formVerify);
        const code = (fd.get("code") || "").toString().trim();
        const data = await api.post("/api/auth/verify-code", {
          email: currentEmail,
          code,
        });
        auth.saveSession(data.token, data.user);
        updateNavUser();
        navigate("/tasks");
      } catch (err) {
        showError(verifyError, err.message || "Anmeldung fehlgeschlagen");
      } finally {
        btn.disabled = false;
        btn.textContent = "Anmelden";
      }
    });

    // Back to step 1
    backToEmail.addEventListener("click", (e) => {
      e.preventDefault();
      formVerify.classList.add("hidden");
      hideError(verifyError);
      formRequest.classList.remove("hidden");
      formRequest.querySelector("input[name=email]").value = currentEmail;
      formRequest.querySelector("input[name=email]").focus();
    });
  }

  function updateNavUser() {
    const user = auth.getUser();
    const el = document.getElementById("nav-username");
    el.textContent = user ? user.name : "";
  }

  // ---- Logout ----
  function initLogout() {
    document.getElementById("btn-logout").addEventListener("click", () => {
      auth.clearSession();
      updateNavUser();
      navigate("/login");
    });
  }

  // ---- Task Modal & CRUD ----
  let taskFilter = "all";
  let taskModalFile = null;

  function openTaskModal() {
    document.getElementById("task-modal").classList.remove("hidden");
    document.getElementById("task-title").focus();
  }

  function closeTaskModal() {
    document.getElementById("task-modal").classList.add("hidden");
    // Reset form
    document.getElementById("task-modal-form").reset();
    taskModalFile = null;
    document.getElementById("task-file-preview").classList.add("hidden");
  }

  function initTaskView() {
    const errorEl = document.getElementById("task-create-error");
    const filter = document.getElementById("task-status-filter");

    // New task button opens modal
    document.getElementById("btn-new-task").addEventListener("click", openTaskModal);

    // Cancel button closes modal
    document.getElementById("task-modal-cancel").addEventListener("click", closeTaskModal);

    // Click outside modal closes it
    document.getElementById("task-modal").addEventListener("click", (e) => {
      if (e.target.id === "task-modal") closeTaskModal();
    });

    // Dropzone handling
    const dropzone = document.getElementById("task-dropzone");
    const fileInput = document.getElementById("task-file-input");

    dropzone.addEventListener("click", () => fileInput.click());

    dropzone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropzone.classList.add("dragover");
    });

    dropzone.addEventListener("dragleave", () => {
      dropzone.classList.remove("dragover");
    });

    dropzone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropzone.classList.remove("dragover");
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        handleTaskFileSelect(files[0]);
      }
    });

    fileInput.addEventListener("change", () => {
      if (fileInput.files.length > 0) {
        handleTaskFileSelect(fileInput.files[0]);
      }
    });

    // Remove file button
    document.getElementById("task-file-remove").addEventListener("click", () => {
      taskModalFile = null;
      fileInput.value = "";
      document.getElementById("task-file-preview").classList.add("hidden");
    });

    // Modal form submission
    document.getElementById("task-modal-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const title = document.getElementById("task-title").value.trim();
      const description = document.getElementById("task-description").value.trim();
      const dueDate = document.getElementById("task-due-date").value || null;

      if (!title) return;

      errorEl.classList.add("hidden");
      try {
        // Create task with optional attachment
        const formData = new FormData();
        formData.append("title", title);
        if (description) formData.append("description", description);
        if (dueDate) formData.append("dueDate", dueDate);
        if (taskModalFile) formData.append("attachment", taskModalFile);

        const h = api._headers();
        delete h["Content-Type"]; // Let browser set multipart boundary

        const res = await fetch(api._baseUrl + "/api/tasks", {
          method: "POST",
          headers: h,
          body: formData,
        });

        const data = await res.json();
        if (!res.ok) {
          const err = new Error(data?.message || res.statusText);
          err.status = res.status;
          throw err;
        }

        closeTaskModal();
        await loadTasks();
      } catch (err) {
        errorEl.textContent = err.message || "Erstellen fehlgeschlagen";
        errorEl.classList.remove("hidden");
      }
    });

    filter.addEventListener("change", () => {
      taskFilter = filter.value;
      loadTasks();
    });
  }

  function handleTaskFileSelect(file) {
    // Accept any file type, max 10MB (enforced server-side)
    taskModalFile = file;
    const preview = document.getElementById("task-file-preview");
    const fileName = document.getElementById("task-file-name");
    fileName.textContent = file.name + " (" + formatFileSize(file.size) + ")";
    preview.classList.remove("hidden");
  }

  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  // ---- Task List Rendering ----
  async function loadTasks() {
    const list = document.getElementById("task-list");
    const empty = document.getElementById("task-empty");
    list.innerHTML = "";

    try {
      const tasks = await api.get("/api/tasks");
      const filtered =
        taskFilter === "all" ? tasks : tasks.filter((t) => t.status === taskFilter);

      if (filtered.length === 0) {
        empty.classList.remove("hidden");
      } else {
        empty.classList.add("hidden");
        filtered.forEach((task) => list.appendChild(renderTaskItem(task)));
      }
    } catch (err) {
      empty.textContent = "Fehler beim Laden der Aufgaben.";
      empty.classList.remove("hidden");
    }
  }

  function renderTaskItem(task) {
    const li = document.createElement("li");
    li.className = "task-item" + (task.status === "done" ? " done" : "");
    li.dataset.id = task.id;

    // Toggle button
    const toggle = document.createElement("button");
    toggle.className = "btn btn-sm task-toggle";
    toggle.textContent = task.status === "done" ? "Erledigt" : "Offen";
    toggle.title = task.status === "done" ? "Auf Offen setzen" : "Als erledigt markieren";
    toggle.addEventListener("click", () => toggleTaskStatus(task));

    // Title (inline-editable)
    const titleSpan = document.createElement("span");
    titleSpan.className = "task-title";
    titleSpan.textContent = task.title;
    titleSpan.addEventListener("dblclick", () => startEditTaskTitle(li, task));

    // Delete button
    const del = document.createElement("button");
    del.className = "btn btn-sm btn-danger";
    del.textContent = "Löschen";
    del.addEventListener("click", () => deleteTask(task.id, li));

    li.appendChild(toggle);
    li.appendChild(titleSpan);
    li.appendChild(del);
    return li;
  }

  function startEditTaskTitle(li, task) {
    const titleSpan = li.querySelector(".task-title");
    const input = document.createElement("input");
    input.type = "text";
    input.className = "inline-edit";
    input.value = task.title;
    input.maxLength = 200;
    titleSpan.replaceWith(input);
    input.focus();
    input.select();

    async function finish() {
      const newTitle = input.value.trim();
      if (newTitle && newTitle !== task.title) {
        try {
          await api.put("/api/tasks/" + task.id, { title: newTitle });
          task.title = newTitle;
        } catch {
          /* revert on error */
        }
      }
      const span = document.createElement("span");
      span.className = "task-title";
      span.textContent = task.title;
      span.addEventListener("dblclick", () => startEditTaskTitle(li, task));
      input.replaceWith(span);
    }

    input.addEventListener("blur", finish);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") input.blur();
      if (e.key === "Escape") {
        input.value = task.title;
        input.blur();
      }
    });
  }

  async function toggleTaskStatus(task) {
    const newStatus = task.status === "done" ? "open" : "done";
    try {
      await api.put("/api/tasks/" + task.id, { status: newStatus });
      await loadTasks();
    } catch (err) {
      /* silently fail — UI will refresh on next load */
    }
  }

  async function deleteTask(id, li) {
    try {
      await api.delete("/api/tasks/" + id);
      li.remove();
      const list = document.getElementById("task-list");
      if (list.children.length === 0) {
        document.getElementById("task-empty").classList.remove("hidden");
      }
    } catch {
      /* silently fail */
    }
  }

  // ---- Information CRUD ----
  async function loadInformation() {
    const list = document.getElementById("info-list");
    const empty = document.getElementById("info-empty");
    list.innerHTML = "";

    try {
      const entries = await api.get("/api/information");

      if (entries.length === 0) {
        empty.classList.remove("hidden");
      } else {
        empty.classList.add("hidden");
        entries.forEach((entry) => list.appendChild(renderInfoItem(entry)));
      }
    } catch (err) {
      empty.textContent = "Fehler beim Laden der Informationen.";
      empty.classList.remove("hidden");
    }
  }

  function renderInfoItem(entry) {
    const li = document.createElement("li");
    li.className = "info-item";
    li.dataset.id = entry.id;

    // Header with title + delete
    const header = document.createElement("div");
    header.className = "info-header";

    const titleSpan = document.createElement("span");
    titleSpan.className = "info-title";
    titleSpan.textContent = entry.title;
    titleSpan.addEventListener("dblclick", () => startEditInfoField(li, entry, "title"));

    const del = document.createElement("button");
    del.className = "btn btn-sm btn-danger";
    del.textContent = "Löschen";
    del.addEventListener("click", () => deleteInfo(entry.id, li));

    header.appendChild(titleSpan);
    header.appendChild(del);

    // Content (inline-editable)
    const contentSpan = document.createElement("p");
    contentSpan.className = "info-content";
    contentSpan.textContent = entry.content;
    contentSpan.addEventListener("dblclick", () => startEditInfoField(li, entry, "content"));

    li.appendChild(header);
    li.appendChild(contentSpan);
    return li;
  }

  function startEditInfoField(li, entry, field) {
    const selector = field === "title" ? ".info-title" : ".info-content";
    const el = li.querySelector(selector);

    let input;
    if (field === "content") {
      input = document.createElement("textarea");
      input.rows = 3;
      input.maxLength = 10000;
    } else {
      input = document.createElement("input");
      input.type = "text";
      input.maxLength = 200;
    }
    input.className = "inline-edit";
    input.value = entry[field];
    el.replaceWith(input);
    input.focus();
    input.select();

    async function finish() {
      const newVal = input.value.trim();
      if (newVal && newVal !== entry[field]) {
        try {
          await api.put("/api/information/" + entry.id, { [field]: newVal });
          entry[field] = newVal;
        } catch {
          /* revert */
        }
      }
      const restored =
        field === "title"
          ? document.createElement("span")
          : document.createElement("p");
      restored.className = field === "title" ? "info-title" : "info-content";
      restored.textContent = entry[field];
      restored.addEventListener("dblclick", () => startEditInfoField(li, entry, field));
      input.replaceWith(restored);
    }

    input.addEventListener("blur", finish);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && field === "title") input.blur();
      if (e.key === "Escape") {
        input.value = entry[field];
        input.blur();
      }
    });
  }

  async function deleteInfo(id, li) {
    try {
      await api.delete("/api/information/" + id);
      li.remove();
      const list = document.getElementById("info-list");
      if (list.children.length === 0) {
        document.getElementById("info-empty").classList.remove("hidden");
      }
    } catch {
      /* silently fail */
    }
  }

  function initInfoView() {
    const form = document.getElementById("info-create-form");
    const errorEl = document.getElementById("info-create-error");

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const titleInput = document.getElementById("info-create-title");
      const contentInput = document.getElementById("info-create-content");
      const title = titleInput.value.trim();
      const content = contentInput.value.trim();
      if (!title || !content) return;

      errorEl.classList.add("hidden");
      try {
        await api.post("/api/information", { title, content });
        titleInput.value = "";
        contentInput.value = "";
        await loadInformation();
      } catch (err) {
        errorEl.textContent = err.message || "Erstellen fehlgeschlagen";
        errorEl.classList.remove("hidden");
      }
    });
  }

  // ---- Calendar & Duty ----
  let calYear, calMonth; // 0-indexed month
  let calUsers = [];
  let calAssignments = {}; // "YYYY-MM-DD" -> { userId, userName }

  function initCalendar() {
    const now = new Date();
    calYear = now.getFullYear();
    calMonth = now.getMonth();

    document.getElementById("cal-prev").addEventListener("click", () => {
      calMonth--;
      if (calMonth < 0) { calMonth = 11; calYear--; }
      loadCalendar();
    });
    document.getElementById("cal-next").addEventListener("click", () => {
      calMonth++;
      if (calMonth > 11) { calMonth = 0; calYear++; }
      loadCalendar();
    });
    document.getElementById("cal-today").addEventListener("click", () => {
      const d = new Date();
      calYear = d.getFullYear();
      calMonth = d.getMonth();
      loadCalendar();
    });

    // Email trigger
    document.getElementById("btn-send-email").addEventListener("click", sendEmail);

    // Duty modal
    document.getElementById("duty-save").addEventListener("click", saveDuty);
    document.getElementById("duty-remove").addEventListener("click", removeDuty);
    document.getElementById("duty-cancel").addEventListener("click", closeDutyModal);
    document.getElementById("duty-modal").addEventListener("click", (e) => {
      if (e.target.id === "duty-modal") closeDutyModal();
    });
  }

  async function loadCalendar() {
    const body = document.getElementById("calendar-body");
    body.innerHTML = "";

    // Update title
    const monthNames = [
      "Januar", "Februar", "März", "April", "Mai", "Juni",
      "Juli", "August", "September", "Oktober", "November", "Dezember",
    ];
    document.getElementById("calendar-title").textContent =
      monthNames[calMonth] + " " + calYear;

    // Load users (cache for session)
    if (calUsers.length === 0) {
      try {
        calUsers = await api.get("/api/users");
      } catch {
        calUsers = [];
      }
    }

    // Load assignments for month
    calAssignments = {};
    try {
      const assignments = await api.get(
        "/api/duty/month?year=" + calYear + "&month=" + (calMonth + 1)
      );
      assignments.forEach((a) => {
        calAssignments[a.date] = { id: a.id, userId: a.userId, userName: a.userName };
      });
    } catch {
      /* empty */
    }

    // Build grid
    const firstDay = new Date(calYear, calMonth, 1);
    let startDow = firstDay.getDay(); // 0=Sun
    startDow = startDow === 0 ? 6 : startDow - 1; // Convert to Mon=0

    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const today = new Date();
    const todayStr =
      today.getFullYear() +
      "-" +
      String(today.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(today.getDate()).padStart(2, "0");

    // Leading empty cells
    for (let i = 0; i < startDow; i++) {
      const cell = document.createElement("div");
      cell.className = "cal-cell cal-cell-empty";
      body.appendChild(cell);
    }

    // Day cells
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr =
        calYear +
        "-" +
        String(calMonth + 1).padStart(2, "0") +
        "-" +
        String(day).padStart(2, "0");

      const cell = document.createElement("div");
      cell.className = "cal-cell";
      if (dateStr === todayStr) cell.classList.add("cal-today");

      const dayNum = document.createElement("div");
      dayNum.className = "cal-day-number";
      dayNum.textContent = day;
      cell.appendChild(dayNum);

      const assignment = calAssignments[dateStr];
      if (assignment) {
        const nameEl = document.createElement("div");
        nameEl.className = "cal-duty-name";
        nameEl.textContent = assignment.userName;
        cell.appendChild(nameEl);
        cell.classList.add("cal-has-duty");
      }

      cell.addEventListener("click", () => openDutyModal(dateStr, assignment));
      body.appendChild(cell);
    }
  }

  let _currentDutyDate = null;

  function openDutyModal(dateStr, assignment) {
    _currentDutyDate = dateStr;

    // Format date for display
    const parts = dateStr.split("-");
    const displayDate = parts[2] + "." + parts[1] + "." + parts[0];
    document.getElementById("duty-modal-title").textContent =
      "Dienst zuweisen — " + displayDate;

    // Populate user dropdown
    const select = document.getElementById("duty-user-select");
    select.innerHTML = '<option value="">— Bitte wählen —</option>';
    calUsers.forEach((u) => {
      const opt = document.createElement("option");
      opt.value = u.id;
      opt.textContent = u.name;
      if (assignment && assignment.userId === u.id) opt.selected = true;
      select.appendChild(opt);
    });

    // Show/hide remove button
    const removeBtn = document.getElementById("duty-remove");
    if (assignment) {
      removeBtn.classList.remove("hidden");
    } else {
      removeBtn.classList.add("hidden");
    }

    document.getElementById("duty-modal").classList.remove("hidden");
    select.focus();
  }

  function closeDutyModal() {
    document.getElementById("duty-modal").classList.add("hidden");
    _currentDutyDate = null;
  }

  async function saveDuty() {
    const select = document.getElementById("duty-user-select");
    const userId = parseInt(select.value, 10);
    if (!userId || !_currentDutyDate) return;

    const existing = calAssignments[_currentDutyDate];
    try {
      if (existing) {
        await api.put("/api/duty/" + existing.id, { userId });
      } else {
        await api.post("/api/duty", { date: _currentDutyDate, userId });
      }
      closeDutyModal();
      await loadCalendar();
    } catch (err) {
      alert(err.message || "Zuweisung fehlgeschlagen");
    }
  }

  async function removeDuty() {
    if (!_currentDutyDate) return;
    const existing = calAssignments[_currentDutyDate];
    if (!existing) { closeDutyModal(); return; }
    try {
      await api.delete("/api/duty/" + existing.id);
      closeDutyModal();
      await loadCalendar();
    } catch (err) {
      alert(err.message || "Entfernen fehlgeschlagen");
    }
  }

  async function sendEmail() {
    const msgEl = document.getElementById("cal-email-msg");
    msgEl.classList.remove("hidden");
    msgEl.className = "info-msg";
    msgEl.textContent = "Sende E-Mail…";

    try {
      const result = await api.post("/api/email/send", {});
      msgEl.className = "info-msg success-msg";
      msgEl.textContent =
        "E-Mail erfolgreich gesendet an " +
        result.dutyUser +
        " (" +
        result.taskCount +
        " Aufgaben, " +
        result.infoCount +
        " Informationen).";
    } catch (err) {
      msgEl.className = "error-msg";
      msgEl.textContent = err.message || "E-Mail-Versand fehlgeschlagen.";
    }

    // Hide message after 5 seconds
    setTimeout(() => msgEl.classList.add("hidden"), 5000);
  }

  // ---- Setup (first-run) ----
  async function checkSetupStatus() {
    try {
      const data = await api.get("/api/setup/status");
      return data.needsSetup;
    } catch {
      return false;
    }
  }

  function initSetupForm() {
    const form = document.getElementById("form-setup");
    const errorEl = document.getElementById("setup-error");

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      hideError(errorEl);
      const btn = form.querySelector("button[type=submit]");
      btn.disabled = true;
      btn.textContent = "Einrichten…";

      try {
        const fd = new FormData(form);
        const name = (fd.get("name") || "").toString().trim();
        const email = (fd.get("email") || "").toString().trim().toLowerCase();

        const body = { name, email };

        // SMTP fields are optional — only include if at least host is filled
        const smtpHost = (fd.get("smtp_host") || "").toString().trim();
        if (smtpHost) {
          const port = parseInt((fd.get("smtp_port") || "").toString().trim(), 10);
          body.smtp = {
            host: smtpHost,
            port: isNaN(port) ? 587 : port,
            user: (fd.get("smtp_user") || "").toString().trim(),
            pass: (fd.get("smtp_pass") || "").toString().trim(),
            from: (fd.get("smtp_from") || "").toString().trim(),
          };
        }

        const data = await api.post("/api/setup", body);
        auth.saveSession(data.token, data.user);
        updateNavUser();
        navigate("/tasks");
      } catch (err) {
        showError(errorEl, err.message || "Einrichtung fehlgeschlagen");
      } finally {
        btn.disabled = false;
        btn.textContent = "Einrichtung abschließen";
      }
    });
  }

  // ---- Admin User Management ----
  async function loadAdminUsers() {
    const list = document.getElementById("admin-user-list");
    const empty = document.getElementById("admin-empty");
    list.innerHTML = "";

    try {
      const users = await api.get("/api/admin/users");
      if (users.length === 0) {
        empty.classList.remove("hidden");
      } else {
        empty.classList.add("hidden");
        users.forEach((u) => list.appendChild(renderAdminUser(u)));
      }
    } catch (err) {
      empty.textContent = "Fehler beim Laden der Benutzer.";
      empty.classList.remove("hidden");
    }
  }

  function renderAdminUser(user) {
    const li = document.createElement("li");
    li.className = "admin-user-item";
    li.dataset.id = user.id;

    const info = document.createElement("span");
    info.className = "admin-user-info";
    info.textContent = user.name + " — " + user.email + " (" + user.role + ")";

    const del = document.createElement("button");
    del.className = "btn btn-sm btn-danger";
    del.textContent = "Löschen";
    del.addEventListener("click", () => deleteAdminUser(user.id, li));

    li.appendChild(info);
    li.appendChild(del);
    return li;
  }

  async function deleteAdminUser(id, li) {
    const errorEl = document.getElementById("admin-create-error");
    errorEl.classList.add("hidden");
    try {
      await api.delete("/api/admin/users/" + id);
      li.remove();
      const list = document.getElementById("admin-user-list");
      if (list.children.length === 0) {
        document.getElementById("admin-empty").classList.remove("hidden");
      }
    } catch (err) {
      errorEl.textContent = err.message || "Löschen fehlgeschlagen";
      errorEl.classList.remove("hidden");
    }
  }

  function initAdminView() {
    const form = document.getElementById("admin-create-form");
    const errorEl = document.getElementById("admin-create-error");

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      errorEl.classList.add("hidden");
      const email = document.getElementById("admin-create-email").value.trim().toLowerCase();
      const name = document.getElementById("admin-create-name").value.trim();
      const role = document.getElementById("admin-create-role").value;

      try {
        await api.post("/api/admin/users", { email, name, role });
        document.getElementById("admin-create-email").value = "";
        document.getElementById("admin-create-name").value = "";
        await loadAdminUsers();
      } catch (err) {
        errorEl.textContent = err.message || "Erstellen fehlgeschlagen";
        errorEl.classList.remove("hidden");
      }
    });
  }

  // ---- Settings ----
  async function loadSmtpSettings() {
    try {
      const data = await api.get("/api/settings/smtp");
      const form = document.getElementById("settings-smtp-form");
      form.querySelector("[name=smtp_host]").value = data.host || "";
      form.querySelector("[name=smtp_port]").value = data.port || 587;
      form.querySelector("[name=smtp_user]").value = data.user || "";
      form.querySelector("[name=smtp_pass]").value = data.pass || "";
      form.querySelector("[name=smtp_from]").value = data.from || "";
    } catch {
      /* ignore load errors */
    }
  }

  function initSettingsView() {
    const form = document.getElementById("settings-smtp-form");
    const errorEl = document.getElementById("settings-smtp-error");
    const successEl = document.getElementById("settings-smtp-success");

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      errorEl.classList.add("hidden");
      successEl.classList.add("hidden");

      const host = form.querySelector("[name=smtp_host]").value.trim();
      const port = parseInt(form.querySelector("[name=smtp_port]").value, 10);
      const user = form.querySelector("[name=smtp_user]").value.trim();
      const pass = form.querySelector("[name=smtp_pass]").value.trim();
      const from = form.querySelector("[name=smtp_from]").value.trim();

      try {
        await api.put("/api/settings/smtp", { host, port: isNaN(port) ? 587 : port, user, pass, from });
        successEl.textContent = "SMTP-Einstellungen gespeichert.";
        successEl.classList.remove("hidden");
      } catch (err) {
        errorEl.textContent = err.message || "Speichern fehlgeschlagen";
        errorEl.classList.remove("hidden");
      }
    });
  }

  // ---- View lifecycle: load data when navigating ----
  function onViewEnter(viewId) {
    if (viewId === "view-tasks") loadTasks();
    if (viewId === "view-information") loadInformation();
    if (viewId === "view-calendar") loadCalendar();
    if (viewId === "view-admin") loadAdminUsers();
    if (viewId === "view-settings") loadSmtpSettings();
  }

  // Patch onRouteChange to trigger data loads
  const _origShowView = showView;
  showView = function (viewId) {
    _origShowView(viewId);
    onViewEnter(viewId);
  };

  // ---- Init ----
  async function init() {
    initAuthForms();
    initLogout();
    initTaskView();
    initInfoView();
    initCalendar();
    initSetupForm();
    initAdminView();
    initSettingsView();
    updateNavUser();

    window.addEventListener("hashchange", onRouteChange);

    // Check setup status before routing
    const needsSetup = await checkSetupStatus();
    if (needsSetup) {
      // Force setup view, hide everything else
      document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
      document.getElementById("view-setup").classList.remove("hidden");
      document.getElementById("nav").classList.add("hidden");
      return; // skip onRouteChange — no other view is valid
    }

    onRouteChange();
  }

  // Wait for DOM
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
