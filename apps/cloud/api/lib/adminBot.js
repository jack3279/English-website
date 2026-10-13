const store = require("./secureStore.js"),
  provider = require("./adminBotProvider.js"),
  data = require("./adminBotData.js");
const { getAdmin, createAuthClient } = require("./supabase.js");
const { HttpError } = require("./errors.js");
const LEGACY_KEY = "private/admin-bot/state-v1",
  RESERVE = 60000;
const DEFAULT = {
  ownerId: null,
  enabled: false,
  apiKey: "",
  consent: false,
  includeNames: false,
  budgetYuan: 20,
  dailyLimit: 20,
  reminders: false,
  lessonReminders: false,
  lessonReminderMinutes: 30,
  reminderTimes: ["10:00", "17:00"],
  version: 0,
  bot: null,
  pair: null,
  proof: null,
  runtime: {
    cursor: "",
    context: null,
    contextAt: 0,
    history: [],
    queue: [],
    handled: [],
    requests: {},
    usage: {},
    lock: null,
    lastError: null,
    lastCheck: null,
  },
};
function createAssistant(KEY = LEGACY_KEY) {
  async function state() {
    return store.ready() ? (await store.read(KEY, DEFAULT)).value : structuredClone(DEFAULT);
  }
  function change(fn) {
    return store.change(KEY, DEFAULT, fn);
  }
  function owner(c, id) {
    if (c.ownerId && c.ownerId !== id)
      throw new HttpError(403, "BOT_OWNER_ONLY", "机器人只由已配置的管理员本人管理");
  }
  function view(c, id) {
    owner(c, id);
    return {
      storageReady: store.ready(),
      configured: !!c.ownerId,
      enabled: c.enabled,
      keyConfigured: !!c.apiKey,
      consent: c.consent,
      includeNames: c.includeNames,
      budgetYuan: c.budgetYuan,
      dailyLimit: c.dailyLimit,
      reminders: c.reminders,
      lessonReminders: c.lessonReminders ?? false,
      lessonReminderMinutes: c.lessonReminderMinutes ?? 30,
      lastLessonReminder: c.runtime.lastLessonReminder || null,
      reminderTimes: c.reminderTimes,
      bound: !!c.bot,
      pairStatus: c.pair?.candidate ? "awaiting_code" : c.pair ? "awaiting_scan" : null,
      binding:
        c.pair?.until > Date.now()
          ? {
              id: c.pair.id,
              image: c.pair.image,
              expiresAt: c.pair.until,
              status: c.pair.candidate ? "awaiting_code" : "wait",
              bindText: c.pair.candidate ? `绑定 ${c.pair.code}` : "",
            }
          : null,
      history: c.runtime.history.slice(-6),
      reauthUntil: c.proof?.until || 0,
      lastError: c.runtime.lastError,
      lastCheck: c.runtime.lastCheck,
      connectionWarning: c.runtime.connectionWarning || null,
      bindingCheck: c.pair?.diagnostic || null,
      queued: c.runtime.queue.length,
      usage: c.runtime.usage,
    };
  }
  async function proof(req, password) {
    if (password === "Demo1234!")
      throw new HttpError(
        409,
        "BOT_SECURE_ACCOUNT_REQUIRED",
        "请先修改公开的测试初始密码，再配置机器人密钥",
      );
    const { data: identity, error } = await getAdmin().auth.getUser(req.context.jwt);
    if (error || identity?.user?.id !== req.context.userId)
      throw new HttpError(401, "UNAUTHORIZED", "请重新登录管理员账号");
    const authClient = createAuthClient();
    try {
      const { data: verified, error: bad } = await authClient.auth.signInWithPassword({
        email: identity.user.email,
        password,
      });
      if (bad || verified?.user?.id !== req.context.userId)
        throw new HttpError(400, "CURRENT_PASSWORD_INVALID", "当前管理员密码不正确");
    } finally {
      try {
        await authClient.auth.signOut({ scope: "local" });
      } catch {}
    }
  }
  async function save(req, input) {
    const actor = req.context.userId;
    owner(await state(), actor);
    if (input.current_password) await proof(req, input.current_password);
    else await assertProof(req, await state());
    const fingerprint = await store.hash(req.context.jwt);
    return change((c) => {
      owner(c, actor);
      if (input.enabled && (!c.bot || !(input.apiKey || c.apiKey) || !input.consent))
        throw new HttpError(
          409,
          "BOT_NOT_READY",
          "请先保存密钥、确认AI数据使用范围，并完成微信绑定",
        );
      const privacyChanged =
        c.includeNames !== input.includeNames || c.consent !== input.consent || !!input.apiKey;
      return {
        ...c,
        ownerId: actor,
        apiKey: input.apiKey || c.apiKey,
        consent: input.consent,
        includeNames: input.includeNames,
        budgetYuan: input.budgetYuan,
        dailyLimit: input.dailyLimit,
        enabled: input.enabled,
        reminders: input.reminders,
        lessonReminders: input.lessonReminders ?? c.lessonReminders ?? false,
        lessonReminderMinutes: input.lessonReminderMinutes ?? c.lessonReminderMinutes ?? 30,
        reminderTimes: input.reminderTimes,
        version: c.version + 1,
        proof: { fingerprint, until: Date.now() + 10 * 60000 },
        runtime: { ...c.runtime, history: privacyChanged ? [] : c.runtime.history },
      };
    });
  }
  async function liveOwner(c) {
    if (!c.ownerId) throw new HttpError(403, "BOT_OWNER_REQUIRED", "尚未配置管理员");
    const { data: profile, error } = await getAdmin()
      .from("profiles")
      .select("role")
      .eq("id", c.ownerId)
      .maybeSingle();
    if (error || profile?.role !== "admin")
      throw new HttpError(403, "BOT_OWNER_INACTIVE", "绑定管理员已失去访问权限，机器人停止运行");
    await data.ownerAccount(c.ownerId);
  }
  async function assertProof(req, c) {
    owner(c, req.context.userId);
    if (
      !c.proof ||
      c.proof.until < Date.now() ||
      c.proof.fingerprint !== (await store.hash(req.context.jwt))
    )
      throw new HttpError(
        409,
        "BOT_REAUTH_REQUIRED",
        "请先保存设置并验证当前管理员密码，再生成二维码",
      );
  }
  async function makeQr(req) {
    const c = await state();
    await assertProof(req, c);
    const qr = await provider.qr();
    const pair = {
      id: store.randomId(),
      qrcode: String(qr.qrcode),
      image: String(qr.qrcode_img_content),
      base: provider.BASE,
      code: String(
        ((globalThis.crypto || require("node:crypto").webcrypto).getRandomValues(
          new Uint32Array(1),
        )[0] %
          90000000) +
          10000000,
      ),
      until: Date.now() + 10 * 60000,
      candidate: null,
      cursor: "",
    };
    await change((current) => {
      owner(current, req.context.userId);
      return { ...current, pair };
    });
    return { id: pair.id, image: pair.image, expiresAt: pair.until };
  }
  async function checkQr(req, pairId, verification) {
    const c = await state();
    owner(c, req.context.userId);
    const pair = c.pair;
    if (!pair || pair.id !== pairId || pair.until < Date.now())
      throw new HttpError(409, "BOT_QR_EXPIRED", "绑定已过期，请重新生成二维码");
    if (pair.candidate) {
      await announceStart(pair.candidate);
      return { status: "awaiting_code", bindText: `绑定 ${pair.code}` };
    }
    const result = await provider.qrState(pair, verification);
    if (result.status === "scaned_but_redirect" && result.redirect_host) {
      await change((s) =>
        s.pair?.id === pairId
          ? {
              ...s,
              pair: {
                ...s.pair,
                base: provider.validBase(
                  String(result.redirect_host).startsWith("https://")
                    ? result.redirect_host
                    : `https://${result.redirect_host}`,
                ),
              },
            }
          : null,
      );
      return { status: "wait" };
    }
    if (result.status === "confirmed") {
      if (!result.bot_token || !result.ilink_user_id || !result.ilink_bot_id)
        throw new HttpError(502, "BOT_BINDING_INCOMPLETE", "微信返回的绑定资料不完整，请重新扫码");
      const candidate = {
        token: result.bot_token,
        peer: result.ilink_user_id,
        id: result.ilink_bot_id,
        base: provider.validBase(result.baseurl || provider.BASE),
      };
      await claimWechat(req.context.userId, candidate.peer, pair.until);
      await change((s) =>
        s.pair?.id === pairId ? { ...s, pair: { ...s.pair, candidate } } : null,
      );
      await announceStart(candidate);
      return { status: "awaiting_code", bindText: `绑定 ${pair.code}` };
    }
    return { status: result.status || "wait" };
  }
  async function announceStart(bot) {
    // Match the official channel lifecycle. A notification failure must not
    // prevent polling; expose it separately from message-processing errors.
    let warning = null;
    try {
      await provider.start(bot);
    } catch (error) {
      warning = error.message;
    }
    await change((c) => {
      const active = c.pair?.candidate || c.bot;
      if (active?.token !== bot.token) return null;
      return { ...c, runtime: { ...c.runtime, connectionWarning: warning } };
    });
  }
  function textOf(m) {
    return (m.item_list || [])
      .map((i) => (i.type === 1 ? i.text_item?.text : i.type === 3 ? i.voice_item?.text : ""))
      .filter(Boolean)
      .join("\n")
      .slice(0, 1000);
  }
  function accepts(bot, m) {
    return (
      m.from_user_id === bot.peer &&
      (!m.to_user_id || m.to_user_id === bot.id) &&
      !m.group_id &&
      !m.delete_time_ms &&
      m.message_type === 1 &&
      m.message_state !== 1
    );
  }
  function matchesBinding(text, code) {
    const normalized = String(text).normalize("NFKC").trim();
    const match = /^(?:绑定\s*)?(\d{8})$/.exec(normalized);
    return !!match && match[1] === code;
  }
  async function messageId(m) {
    return store.hash(
      JSON.stringify({
        peer: m.from_user_id,
        id: Number.isSafeInteger(m.message_id) ? m.message_id : m.client_id || null,
        time: m.create_time_ms,
        seq: m.seq,
        text: textOf(m),
      }),
    );
  }
  async function reserve(id, c, fingerprint) {
    const now = Date.now(),
      day = new Date(now + 8 * 3600000).toISOString().slice(0, 10),
      month = day.slice(0, 7);
    let cached = null;
    const value = await change((s) => {
      if (s.version !== c.version || !s.consent || !s.apiKey)
        throw new HttpError(409, "BOT_CONFIG_CHANGED", "配置已变化，请重新提交");
      const old = s.runtime.requests[id];
      if (old) {
        if (old.fingerprint && old.fingerprint !== fingerprint)
          throw new HttpError(409, "BOT_REQUEST_CHANGED", "提问内容已变化，请重新提交");
        if (old.state === "done") {
          cached = old.reply;
          return null;
        }
        throw new HttpError(
          409,
          "BOT_ANSWER_UNKNOWN",
          "这次提问结果尚未确认，为避免重复费用未再次调用",
        );
      }
      let u = s.runtime.usage;
      if (u.month !== month) u = { month, day, calls: 0, usedMicros: 0 };
      if (u.day !== day) u = { ...u, day, calls: 0 };
      if (u.calls >= s.dailyLimit || u.usedMicros + RESERVE > s.budgetYuan * 1e6)
        throw new HttpError(429, "BOT_BUDGET_LIMIT", "已达到每日次数或本月估算额度，暂停AI调用");
      const requests = { ...s.runtime.requests, [id]: { state: "pending", at: now, fingerprint } };
      for (const key of Object.keys(requests).slice(0, -40)) delete requests[key];
      return {
        ...s,
        runtime: {
          ...s.runtime,
          usage: { ...u, calls: u.calls + 1, usedMicros: u.usedMicros + RESERVE },
          requests,
        },
      };
    });
    return { cached, reserved: !!value };
  }
  async function answer(id, question) {
    const c = await state();
    await liveOwner(c);
    if (!c.apiKey || !c.consent)
      throw new HttpError(409, "BOT_AI_NOT_CONFIGURED", "请先配置DeepSeek并确认数据使用范围");
    const { cached } = await reserve(id, c, await store.hash(question));
    if (cached != null) return cached;
    try {
      const snapshot = await data.snapshot(c.includeNames);
      const safeQuestion = question.replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, "[密钥已隐藏]");
      const system = {
        role: "system",
        content: `你是17say管理员的只读教务助手。只根据下面实时快照和对话回答；缺少的数据明确说无法判断。不得编造姓名、金额、日期。你没有审批、排课、改账、退款、发通知、操作系统或数据库的工具，绝不能声称已执行操作。需要处理时给出 https://17say.org/admin/operations 或对应网站页面。快照已按管理员许可过滤，不能输出其中没有的联系方式。\n${JSON.stringify(snapshot)}`,
      };
      let history = c.runtime.history
        .filter((h) => h.at > Date.now() - 86400000)
        .slice(-6)
        .map(({ role, content }) => ({ role, content }));
      let messages = [system, ...history, { role: "user", content: safeQuestion }];
      while (Buffer.byteLength(JSON.stringify(messages), "utf8") > 24000 && history.length) {
        history = history.slice(1);
        messages = [system, ...history, { role: "user", content: safeQuestion }];
      }
      const live = await state();
      if (live.version !== c.version)
        throw new HttpError(409, "BOT_CONFIG_CHANGED", "配置已变化，未调用模型");
      const output = await provider.deepseek(c.apiKey, messages);
      await change((s) => {
        const request = s.runtime.requests[id];
        if (!request) throw new HttpError(409, "BOT_ANSWER_UNKNOWN", "结果存储状态未能确认");
        const current = s.version === c.version;
        return {
          ...s,
          runtime: {
            ...s.runtime,
            usage: {
              ...s.runtime.usage,
              usedMicros: Math.max(0, s.runtime.usage.usedMicros - RESERVE + output.cost),
            },
            requests: {
              ...s.runtime.requests,
              [id]: {
                ...request,
                state: "done",
                reply: current ? output.reply : "配置已变化，请重新提问",
              },
            },
            history: current
              ? [
                  ...s.runtime.history,
                  { role: "user", content: safeQuestion, at: Date.now() },
                  { role: "assistant", content: output.reply, at: Date.now() },
                ].slice(-6)
              : s.runtime.history,
          },
        };
      });
      return output.reply;
    } catch (error) {
      await change((s) => ({
        ...s,
        runtime: {
          ...s.runtime,
          requests: {
            ...s.runtime.requests,
            [id]: { ...s.runtime.requests[id], state: "unknown", at: Date.now() },
          },
          lastError: error.message,
        },
      }));
      throw error;
    }
  }
  async function lock() {
    const owner = store.randomId(),
      now = Date.now();
    const s = await change((c) =>
      c.runtime.lock?.until > now
        ? null
        : { ...c, runtime: { ...c.runtime, lock: { owner, until: now + 180000 } } },
    );
    return s ? owner : null;
  }
  async function unlock(owner) {
    await change((c) =>
      c.runtime.lock?.owner === owner ? { ...c, runtime: { ...c.runtime, lock: null } } : null,
    );
  }
  async function tick() {
    if (!store.ready()) return { disabled: true };
    let c = await state();
    if (!c.enabled && (!c.pair?.candidate || c.pair.until < Date.now())) return { disabled: true };
    if (c.runtime.cooldownUntil > Date.now()) return { cooldown: true };
    const lease = await lock();
    if (!lease) return { busy: true };
    try {
      c = await state();
      await liveOwner(c);
      if (c.pair?.candidate && c.pair.until > Date.now()) {
        await announceStart(c.pair.candidate);
        const incoming = await provider.updates(c.pair.candidate, c.pair.cursor);
        const messages = incoming.msgs || [];
        const diagnostic = {
          received: messages.length,
          ownSender: messages.filter((m) => m.from_user_id === c.pair.candidate.peer).length,
          accepted: messages.filter((m) => accepts(c.pair.candidate, m)).length,
          codeMatched: messages.filter((m) => matchesBinding(textOf(m), c.pair.code)).length,
          withContext: messages.filter((m) => !!m.context_token).length,
          states: [...new Set(messages.map((m) => m.message_state))],
          types: [...new Set(messages.map((m) => m.message_type))],
        };
        diagnostic.at = new Date().toISOString();
        require("./log.js").info("admin_bot_binding_check", { diagnostic });
        const found = (incoming.msgs || []).find(
          (m) =>
            accepts(c.pair.candidate, m) &&
            matchesBinding(textOf(m), c.pair.code) &&
            m.context_token,
        );
        if (found) await claimWechat(c.ownerId, c.pair.candidate.peer, null);
        await change((s) => {
          if (s.pair?.id !== c.pair.id) return null;
          return found
            ? {
                ...s,
                bot: s.pair.candidate,
                pair: null,
                enabled: false,
                version: s.version + 1,
                runtime: {
                  ...s.runtime,
                  cursor: incoming.get_updates_buf || s.pair.cursor || "",
                  context: found.context_token,
                  contextAt: Date.now(),
                  history: [],
                  queue: [],
                  handled: [],
                  lastError: null,
                  lastCheck: new Date().toISOString(),
                },
              }
            : {
                ...s,
                pair: { ...s.pair, diagnostic, cursor: incoming.get_updates_buf || s.pair.cursor },
                runtime: { ...s.runtime, lastCheck: new Date().toISOString() },
              };
        });
        return { bindingConfirmed: !!found, bindingCheck: diagnostic };
      }
      if (!c.enabled || !c.bot || !c.consent || !c.apiKey) return { disabled: true };
      await announceStart(c.bot);
      const incoming = await provider.updates(c.bot, c.runtime.cursor);
      const jobs = [];
      for (const m of incoming.msgs || [])
        if (
          accepts(c.bot, m) &&
          textOf(m) &&
          !/^绑定\s+\d{8}$/.test(textOf(m).trim()) &&
          m.context_token
        )
          jobs.push({
            id: await messageId(m),
            question: textOf(m),
            context: m.context_token,
            at: Date.now(),
          });
      await change((s) => {
        if (s.version !== c.version) return null;
        const queue = [...s.runtime.queue],
          known = new Set([...s.runtime.handled, ...queue.map((j) => j.id)]);
        let full = false;
        for (const job of jobs) {
          if (known.has(job.id)) continue;
          if (queue.length >= 10) {
            full = true;
            break;
          }
          queue.push(job);
          known.add(job.id);
        }
        const last = jobs[jobs.length - 1];
        return {
          ...s,
          runtime: {
            ...s.runtime,
            queue,
            cursor: full ? s.runtime.cursor : incoming.get_updates_buf || s.runtime.cursor,
            context: last?.context || s.runtime.context,
            contextAt: last ? Date.now() : s.runtime.contextAt,
            lastCheck: new Date().toISOString(),
          },
        };
      });
      c = await state();
      const job = c.runtime.queue[0];
      if (job) {
        await change((s) => ({
          ...s,
          runtime: {
            ...s.runtime,
            queue: s.runtime.queue.filter((j) => j.id !== job.id),
            handled: [...s.runtime.handled, job.id].slice(-100),
          },
        }));
        try {
          const reply = await answer(job.id, job.question);
          const current = await state();
          if (
            current.enabled &&
            current.version === c.version &&
            current.bot?.peer === c.bot.peer
          ) {
            await liveOwner(current);
            await provider.send(current.bot, job.context, reply, `17say_${job.id.slice(0, 32)}`);
          }
          await change((s) => ({ ...s, runtime: { ...s.runtime, lastError: null } }));
        } catch (error) {
          await change((s) => ({ ...s, runtime: { ...s.runtime, lastError: error.message } }));
        }
      }
      await remindLessons(await state());
      await remind(await state());
      return { processed: !!job };
    } catch (error) {
      await change((s) => ({
        ...s,
        enabled: error.code === "BOT_OWNER_INACTIVE" ? false : s.enabled,
        runtime: {
          ...s.runtime,
          cooldownUntil:
            error.code === "WECHAT_SESSION_EXPIRED"
              ? Date.now() + 3600000
              : s.runtime.cooldownUntil,
          lastError: error.message,
          lastCheck: new Date().toISOString(),
        },
      }));
      return { error: error.code || "BOT_ERROR" };
    } finally {
      await unlock(lease);
    }
  }
  async function remindLessons(c) {
    if (!c.enabled || !c.lessonReminders || !c.bot || !c.runtime.context) return;
    const now = Date.now(),
      minutes = c.lessonReminderMinutes ?? 30;
    const candidates = await data.upcomingLessons(minutes, now);
    let attempted = 0;
    for (const candidate of candidates) {
      if (attempted >= 5) break;
      const candidateId = await store.hash(
        `lesson_reminder:${candidate.id}:${candidate.scheduled_at}`,
      );
      if (c.runtime.lessonNotices?.[candidateId]) continue;
      // Re-read just before sending to avoid reminders for cancelled/rescheduled lessons.
      const lesson = await data.currentLesson(candidate.id);
      const start = Date.parse(lesson?.scheduled_at);
      if (
        !lesson ||
        lesson.status !== "scheduled" ||
        start <= now ||
        start > now + minutes * 60000 ||
        start <= now + Math.max(0, minutes - 10) * 60000
      )
        continue;
      const id = await store.hash(`lesson_reminder:${lesson.id}:${lesson.scheduled_at}`);
      const current = await state();
      if (
        !current.enabled ||
        !current.lessonReminders ||
        current.version !== c.version ||
        current.bot?.peer !== c.bot.peer
      )
        return;
      const claimed = await change((s) => {
        if (
          s.version !== c.version ||
          !s.enabled ||
          !s.lessonReminders ||
          s.runtime.lessonNotices?.[id]
        )
          return null;
        const notices = Object.fromEntries(
          Object.entries(s.runtime.lessonNotices || {}).filter(
            ([, entry]) => entry.at > now - 7 * 86400000,
          ),
        );
        return {
          ...s,
          runtime: {
            ...s.runtime,
            lessonNotices: { ...notices, [id]: { state: "sending", at: now } },
          },
        };
      });
      if (!claimed) continue;
      attempted++;
      try {
        const latest = await state();
        if (
          !latest.enabled ||
          !latest.lessonReminders ||
          latest.version !== c.version ||
          latest.bot?.peer !== c.bot.peer
        )
          return;
        await liveOwner(latest);
        if (start <= Date.now()) continue;
        const date = new Date(start).toLocaleDateString("zh-CN", {
          timeZone: "Asia/Shanghai",
          month: "2-digit",
          day: "2-digit",
        });
        const time = (value) =>
          new Date(value).toLocaleTimeString("zh-CN", {
            timeZone: "Asia/Shanghai",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          });
        const remaining = Math.max(1, Math.ceil((start - Date.now()) / 60000));
        const text = `【课前提醒 · 请提醒家长】\n学生：${lesson.students?.full_name || "待查看"}\n教师：${lesson.profiles?.full_name || "待查看"}${lesson.courses?.name ? `\n课程：${lesson.courses.name}` : ""}\n时间：${date} ${time(start)}–${time(start + Number(lesson.duration_min || 60) * 60000)}（北京时间）\n约 ${remaining} 分钟后上课，请联系家长确认准备。\n课表：https://17say.org/schedule`;
        await provider.send(latest.bot, latest.runtime.context, text, `lesson_${id.slice(0, 32)}`);
        await change((s) => ({
          ...s,
          runtime: {
            ...s.runtime,
            lessonNotices: { ...s.runtime.lessonNotices, [id]: { state: "submitted", at: now } },
            lastLessonReminder: { state: "submitted", at: new Date().toISOString() },
          },
        }));
      } catch (error) {
        await change((s) => ({
          ...s,
          runtime: {
            ...s.runtime,
            lessonNotices: { ...s.runtime.lessonNotices, [id]: { state: "unknown", at: now } },
            lastLessonReminder: { state: "unknown", at: new Date().toISOString() },
            lastError: error.message,
          },
        }));
      }
    }
  }
  async function remind(c) {
    if (!c.reminders || !c.runtime.context) return;
    const local = new Date(Date.now() + 8 * 3600000).toISOString(),
      day = local.slice(0, 10),
      time = local.slice(11, 16);
    if (!c.enabled) return;
    const minutes = Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
    const due = c.reminderTimes.find((t) => {
      const scheduled = Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
      return minutes >= scheduled && minutes - scheduled <= 10;
    });
    if (!due) return;
    const id = `notice_${day}_${due}`;
    const snap = await data.snapshot(false);
    const labels = {
      leavePendingOver2Hours: "请假待审批",
      makeupPendingOver24Hours: "补课超过24小时未排",
      newLeadsUncontactedOver24Hours: "新线索超过24小时未联系",
      nextLessonBalanceInsufficient: "24小时内上课但余额不足",
      lessonNotCompletedOver1Hour: "课后超过1小时未登记完课",
      feedbackUnpublishedOver24Hours: "完课超过24小时未发布反馈",
    };
    const links = {
      leavePendingOver2Hours: "/leave",
      makeupPendingOver24Hours: "/leave",
      newLeadsUncontactedOver24Hours: "/admin/leads",
      nextLessonBalanceInsufficient: "/admin/alerts",
      lessonNotCompletedOver1Hour: "/schedule",
      feedbackUnpublishedOver24Hours: "/admin/reports",
    };
    const lines = Object.entries(snap.needsAttention)
      .filter(([, n]) => n > 0)
      .map(([key, n]) => `${labels[key]}：${n} 项\nhttps://17say.org${links[key]}`);
    if (!lines.length) return;
    const claimed = await change((s) =>
      s.version !== c.version || !s.enabled || s.runtime.requests[id]
        ? null
        : {
            ...s,
            runtime: {
              ...s.runtime,
              requests: { ...s.runtime.requests, [id]: { state: "sending", at: Date.now() } },
            },
          },
    );
    if (!claimed) return;
    try {
      await liveOwner(c);
      await provider.send(
        c.bot,
        c.runtime.context,
        `【教务待办】\n${lines.join("\n")}\n查看并处理：https://17say.org/admin/operations`,
        id.replace(/[^a-zA-Z0-9_]/g, "_"),
      );
      await change((s) => ({
        ...s,
        runtime: {
          ...s.runtime,
          requests: { ...s.runtime.requests, [id]: { state: "submitted", at: Date.now() } },
        },
      }));
    } catch (error) {
      await change((s) => ({
        ...s,
        runtime: {
          ...s.runtime,
          requests: {
            ...s.runtime.requests,
            [id]: { ...s.runtime.requests[id], state: "unknown", at: Date.now() },
          },
          lastError: error.message,
        },
      }));
    }
  }
  return {
    state,
    change,
    view,
    owner,
    save,
    makeQr,
    checkQr,
    answer,
    tick,
    accepts,
    textOf,
    KEY,
    DEFAULT,
    RESERVE,
    lock,
    unlock,
  };
}
const registry = require("./adminBotRegistry.js");
async function claimWechat(userId, peer, until) {
  return registry.claimWechat(userId, peer, until);
}
const legacy = createAssistant();
async function forUser(userId) {
  if (typeof userId !== "string" || !userId || userId.length > 128)
    throw new HttpError(400, "BOT_ACCOUNT_INVALID", "管理员账号无效");
  const old = await legacy.state();
  await registry.importLegacy(old);
  const core =
    old.ownerId === userId
      ? legacy
      : createAssistant(`private/admin-bot/users/${await store.hash(userId)}/state-v1`);
  const ownState = await core.state();
  core.owner(ownState, userId);
  if (ownState.ownerId) await registry.register(userId);
  return {
    ...core,
    save: async (req, input) => {
      const value = await core.save(req, input);
      await registry.register(userId);
      return value;
    },
  };
}
async function tickAll() {
  if (!store.ready()) return { disabled: true };
  await registry.importLegacy(await legacy.state());
  const users = await registry.users();
  const results = [],
    pending = [];
  const offset = (Math.floor(Date.now() / 60000) * 20) % Math.max(1, users.length);
  const ordered = [...users.slice(offset), ...users.slice(0, offset)];
  for (const userId of ordered) {
    try {
      const core = await forUser(userId),
        current = await core.state();
      if (!current.enabled && !(current.pair?.candidate && current.pair.until > Date.now()))
        continue;
      const worker = store.env().ADMIN_BOT_WORKER;
      pending.push(() => (worker ? worker.tick(userId) : core.tick()));
      if (pending.length >= 20) break;
    } catch (error) {
      results.push({ error: error.code || "BOT_ERROR" });
    }
  }
  // Bounded parallel polling prevents a quiet account's long poll delaying others.
  for (let i = 0; i < pending.length; i += 4) {
    const batch = await Promise.allSettled(pending.slice(i, i + 4).map((run) => run()));
    results.push(
      ...batch.map((r) => (r.status === "fulfilled" ? r.value : { error: "BOT_WORKER_ERROR" })),
    );
  }
  return {
    accounts: users.length,
    active: results.length,
    errors: results.filter((r) => r.error).length,
  };
}
module.exports = { ...legacy, forUser, tickAll };
