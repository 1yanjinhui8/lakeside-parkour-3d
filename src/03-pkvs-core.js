/*!
 * PKVS — 跑酷双人对战联机插件 v1.0.0
 * Parkour VS: 2-player P2P versus plugin for standalone web games.
 *
 * 传输层 : WebRTC DataChannel P2P 直连（无服务器 / 无账号 / file:// 可用）
 * 信令层 : 离线手动信令码（房主生成邀请码 → 对方回执码 → 房主确认）
 * 依赖   : 无。单文件引入即可。
 *
 * 核心能力:
 *   1. 双端连接（心跳保活、断线检测、时钟同步）
 *   2. 对战流程（同种子开局、统一倒计时、实时进度同步、胜负判定、再战）
 *   3. 自定义事件透传（道具/干扰攻击等，由游戏侧自由定义）
 *
 * 关于蓝牙: 浏览器间蓝牙直连在所有浏览器中都被禁止（Web Bluetooth 只能
 * 连接外设，不能被连接），因此本插件使用 WebRTC P2P —— 同样无需服务器，
 * 局域网内直连（近场体验等同蓝牙），跨网络亦可经 STUN 打洞。
 */
(function (global) {
  'use strict';

  const VERSION = '1.0.0';
  const PROTOCOL = 1;

  /* ==================== 协议消息类型（短键省流量） ==================== */
  const M = Object.freeze({
    HELLO: 'h',   // 握手 { n: 名字, v: 协议版本 }
    PING: 'p',    // 心跳 { a: 发出时本地时间戳 }
    PONG: 'q',    // 回心跳 { a: 原样回传, b: 对端时间戳 }
    START: 's',   // 开局 { seed, sa: 开始时刻(房主钟), cd: 倒计时ms, m: 模式, o: 自定义规则 }
    STATE: 't',   // 高频状态 { ts: 发出时时间戳, d: 游戏自定义状态 }
    EVENT: 'e',   // 稀疏事件 { k: 事件名, d: 数据 }
    FINISH: 'f',  // 上报成绩 { d: {distance, score, timeMs, dnf} }
    RESULT: 'r',  // 终局判定（房主权威） { w: 胜者, rs: 双方成绩, reason }
    REMATCH: 'rm',// 请求再战
    BYE: 'b'      // 主动退出
  });

  const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' }
    // 局域网对战不依赖 STUN（host 候选直接互通），跨网络时才需要。
  ];

  const HEARTBEAT_MS = 1000;     // 心跳间隔
  const DEAD_AFTER_MS = 6000;    // 超过该时长无任何消息判定断线
  const GUEST_FALLBACK_MS = 12000; // 客人侧等待房主终局判定的兜底超时

  /* ==================== 错误类型 ==================== */
  class PKVSError extends Error {
    constructor(code, message) {
      super(message || code);
      this.name = 'PKVSError';
      this.code = code;
    }
  }

  /* ==================== Base64URL ==================== */
  const b64u = {
    enc(bytes) {
      let s = '';
      const CHUNK = 0x8000;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
      }
      return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    },
    dec(str) {
      str = str.replace(/-/g, '+').replace(/_/g, '/');
      while (str.length % 4) str += '=';
      const bin = atob(str);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
  };

  /* ==================== 压缩（CompressionStream + 降级） ==================== */
  const canCompress = typeof CompressionStream === 'function';

  async function deflateText(text) {
    if (canCompress) {
      const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      const buf = new Uint8Array(await new Response(stream).arrayBuffer());
      return { c: 1, b: buf };
    }
    return { c: 0, b: new TextEncoder().encode(text) };
  }

  async function inflateText(bytes, compressed) {
    if (compressed && canCompress) {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return await new Response(stream).text();
    }
    return new TextDecoder().decode(bytes);
  }

  /* ==================== 信令码: PK1<C|R><base64url>.<crc16hex> ==================== */
  const SIGNAL_PREFIX = 'PK1';

  function crc16(str) {
    let crc = 0xFFFF;
    for (let i = 0; i < str.length; i++) {
      crc ^= str.charCodeAt(i) << 8;
      for (let j = 0; j < 8; j++) {
        crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
        crc &= 0xFFFF;
      }
    }
    return crc;
  }

  async function encodeSignal(obj) {
    const { c, b } = await deflateText(JSON.stringify(obj));
    const body = b64u.enc(b);
    const flag = c ? 'C' : 'R';
    return SIGNAL_PREFIX + flag + body + '.' + crc16(body).toString(16).padStart(4, '0');
  }

  async function decodeSignal(code) {
    if (typeof code !== 'string') throw new PKVSError('BAD_SIGNAL', '信令码格式错误');
    const clean = code.replace(/\s+/g, '');
    if (!clean.startsWith(SIGNAL_PREFIX)) throw new PKVSError('BAD_SIGNAL', '不是有效的 PKVS 信令码');
    const rest = clean.slice(SIGNAL_PREFIX.length);
    const flag = rest[0];
    const dot = rest.indexOf('.');
    if (flag !== 'C' && flag !== 'R' || dot < 0) throw new PKVSError('BAD_SIGNAL', '信令码结构损坏');
    const body = rest.slice(1, dot);
    const crc = rest.slice(dot + 1);
    if (crc !== crc16(body).toString(16).padStart(4, '0')) {
      throw new PKVSError('BAD_CRC', '信令码校验失败，请检查是否复制完整');
    }
    try {
      const bytes = b64u.dec(body);
      const json = await inflateText(bytes, flag === 'C');
      return JSON.parse(json);
    } catch (e) {
      throw new PKVSError('BAD_SIGNAL', '信令码解析失败');
    }
  }

  /* ==================== ICE 收集等待 ==================== */
  function countCandidates(pc) {
    const sdp = (pc.localDescription && pc.localDescription.sdp) || '';
    return sdp.split('\n').filter(l => l.startsWith('a=candidate:')).length;
  }

  function waitIceGather(pc, firstTimeoutMs = 5000, extraTimeoutMs = 5000) {
    return new Promise(resolve => {
      if (pc.iceGatheringState === 'complete') return resolve();
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        pc.removeEventListener('icegatheringstatechange', onChange);
        clearTimeout(timer);
        // 一个候选都没有时（STUN 不通），再多等一段完整收集，仍为零则放弃
        if (countCandidates(pc) === 0 && pc.iceGatheringState !== 'complete') {
          const t2 = setTimeout(() => { pc.removeEventListener('icegatheringstatechange', onChange2); resolve(); }, extraTimeoutMs);
          const onChange2 = () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t2); resolve(); } };
          pc.addEventListener('icegatheringstatechange', onChange2);
        } else {
          resolve();
        }
      };
      const onChange = () => { if (pc.iceGatheringState === 'complete') finish(); };
      pc.addEventListener('icegatheringstatechange', onChange);
      const timer = setTimeout(finish, firstTimeoutMs);
    });
  }

  /* ==================== 时钟同步（NTP 式） ==================== */
  class ClockSync {
    constructor() {
      this.offset = 0;      // 对端钟 ≈ 本地钟 + offset
      this.rtt = null;
      this.samples = [];
      this.ready = false;
    }
    addSample(t0Local, t1Peer, t3Local) {
      const rtt = t3Local - t0Local;
      if (rtt <= 0 || rtt > 4000) return; // 丢弃异常样本
      this.rtt = this.rtt == null ? rtt : Math.round(this.rtt * 0.7 + rtt * 0.3);
      this.samples.push(t1Peer - (t0Local + t3Local) / 2);
      if (this.samples.length > 24) this.samples.shift();
      const sorted = this.samples.slice().sort((a, b) => a - b);
      this.offset = sorted[Math.floor(sorted.length / 2)]; // 取中位数抗抖动
      if (!this.ready && this.samples.length >= 6) this.ready = true;
    }
    toLocal(peerTs) { return peerTs - this.offset; }
    peerNow() { return Date.now() + this.offset; }
  }

  /* ==================== 链路层（WebRTC 封装） ==================== */
  class Link {
    constructor(role) {
      this.role = role;             // 'host' | 'guest'
      this.pc = null;
      this.dcCtrl = null;           // 可靠有序：控制/事件/成绩
      this.dcState = null;          // 不可靠不重传：高频进度（旧帧无意义）
      this.rtt = null;
      this.lastRecv = 0;
      this.opened = false;
      this.closed = false;
      // 回调（由上层注入）
      this.onOpen = null;
      this.onClose = null;
      this.onMessage = null;        // (msg, channel) channel: 'ctrl' | 'state'
      this.onPong = null;           // (t0Local, t1Peer, t3Local)
      this._hbTimer = null;
      this._wdTimer = null;
    }

    /* ---- 房主：生成邀请码 ---- */
    async createInvite() {
      this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      this.dcCtrl = this.pc.createDataChannel('pkvs-ctrl', { ordered: true });
      this.dcState = this.pc.createDataChannel('pkvs-state', { ordered: false, maxRetransmits: 0 });
      this._hookChannel(this.dcCtrl);
      this._hookChannel(this.dcState);
      await this.pc.setLocalDescription(await this.pc.createOffer());
      await waitIceGather(this.pc);
      return encodeSignal({ v: PROTOCOL, r: 'h', s: this.pc.localDescription.sdp });
    }

    /* ---- 客人：粘贴邀请码，返回回执码 ---- */
    async joinWithInvite(inviteCode) {
      const sig = await decodeSignal(inviteCode);
      if (sig.r !== 'h') throw new PKVSError('BAD_ROLE', '这是一份回执码而不是邀请码');
      if (sig.v !== PROTOCOL) throw new PKVSError('BAD_VERSION', '插件版本不一致，请使用相同版本');
      this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      this.pc.ondatachannel = (e) => this._attachChannel(e.channel);
      await this.pc.setRemoteDescription({ type: 'offer', sdp: sig.s });
      await this.pc.setLocalDescription(await this.pc.createAnswer());
      await waitIceGather(this.pc);
      return encodeSignal({ v: PROTOCOL, r: 'g', s: this.pc.localDescription.sdp });
    }

    /* ---- 房主：粘贴回执码，完成连接 ---- */
    async confirmWithReply(replyCode) {
      const sig = await decodeSignal(replyCode);
      if (sig.r !== 'g') throw new PKVSError('BAD_ROLE', '这是一份邀请码而不是回执码');
      if (sig.v !== PROTOCOL) throw new PKVSError('BAD_VERSION', '插件版本不一致，请使用相同版本');
      await this.pc.setRemoteDescription({ type: 'answer', sdp: sig.s });
    }

    _attachChannel(ch) {
      if (ch.label === 'pkvs-state') this.dcState = ch;
      else this.dcCtrl = ch;
      this._hookChannel(ch);
    }

    _hookChannel(ch) {
      ch.onopen = () => {
        this.lastRecv = Date.now();
        if (!this.opened && ch === this.dcCtrl) {
          this.opened = true;
          this._startHeartbeat();
          if (this.onOpen) this.onOpen();
        }
      };
      ch.onclose = () => { if (this.opened && !this.closed) this.close('channel-closed'); };
      ch.onerror = () => { /* 由 onclose/watchdog 兜底 */ };
      ch.onmessage = (e) => this._onRaw(e.data, ch);
    }

    _onRaw(data, ch) {
      this.lastRecv = Date.now();
      let msg;
      try { msg = JSON.parse(data); } catch (e) { return; }
      if (msg.t === M.PING) {
        this._send(this.dcCtrl || ch, { t: M.PONG, a: msg.a, b: Date.now() });
        return;
      }
      if (msg.t === M.PONG) {
        if (this.onPong) this.onPong(msg.a, msg.b, Date.now());
        return;
      }
      if (this.onMessage) this.onMessage(msg, ch === this.dcState ? 'state' : 'ctrl');
    }

    _startHeartbeat() {
      this._hbTimer = setInterval(() => {
        this.sendCtrl({ t: M.PING, a: Date.now() });
      }, HEARTBEAT_MS);
      this._wdTimer = setInterval(() => {
        if (Date.now() - this.lastRecv > DEAD_AFTER_MS) this.close('timeout');
      }, 1000);
    }

    sendCtrl(obj) { return this._send(this.dcCtrl, obj); }
    sendState(obj) { return this._send(this.dcState || this.dcCtrl, obj); }

    _send(dc, obj) {
      if (!dc || dc.readyState !== 'open' || this.closed) return false;
      try { dc.send(JSON.stringify(obj)); return true; } catch (e) { return false; }
    }

    isUp() { return !!this.dcCtrl && this.dcCtrl.readyState === 'open' && !this.closed; }

    close(reason) {
      if (this.closed) return;
      this.closed = true;
      clearInterval(this._hbTimer);
      clearInterval(this._wdTimer);
      try { if (this.pc) this.pc.close(); } catch (e) { /* 忽略 */ }
      const cb = this.onClose;
      this.onClose = null;
      if (cb) cb(reason || 'unknown');
    }
  }

  /* ==================== 胜负判定 ==================== */
  function judgeByMode(mode, hostRes, guestRes) {
    const hd = !!(hostRes && hostRes.dnf);
    const gd = !!(guestRes && guestRes.dnf);
    if (hd || gd) {
      if (hd && gd) return 'draw';
      return hd ? 'guest' : 'host';
    }
    if (mode === 'distance') {
      const h = +hostRes.distance || 0, g = +guestRes.distance || 0;
      return h === g ? 'draw' : (h > g ? 'host' : 'guest');
    }
    if (mode === 'score') {
      const h = +hostRes.score || 0, g = +guestRes.score || 0;
      return h === g ? 'draw' : (h > g ? 'host' : 'guest');
    }
    // 默认 race：用时短者胜
    const h = hostRes.timeMs == null ? Infinity : +hostRes.timeMs;
    const g = guestRes.timeMs == null ? Infinity : +guestRes.timeMs;
    return h === g ? 'draw' : (h < g ? 'host' : 'guest');
  }

  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

  /* ==================== 对外主类 ==================== */
  class ParkourVS {
    /**
     * @param {Object} opts
     * @param {string}   opts.name     本方玩家昵称（<=32字符）
     * @param {Function} opts.onEvent  事件回调 (e) => void，e.type 见 README 事件表
     * @param {number}   opts.stateHz  进度同步频率 1~60，默认 15
     */
    constructor(opts = {}) {
      this.version = VERSION;
      this._name = String(opts.name || 'Player').slice(0, 32);
      this._stateHz = clamp(opts.stateHz || 15, 1, 60);
      this._onEvent = typeof opts.onEvent === 'function' ? opts.onEvent : function () {};
      this._role = null;
      this._link = null;
      this._clock = new ClockSync();
      this._clockAnnounced = false;
      this._peerName = null;
      this._phase = 'idle'; // idle|hosting|joining|connected|match|done|closed
      this._match = null;
      this._lastSentAt = 0;
      this._flushTimer = null;
      this._pendingState = null;
      this._wantRematch = false;
      this._peerWantRematch = false;
      this._fbTimer = null;
    }

    /* ---------- 查询 ---------- */
    info() {
      return {
        version: VERSION,
        role: this._role,
        phase: this._phase,
        connected: this._isUp(),
        peerName: this._peerName,
        rttMs: this._link ? this._link.rtt : null,
        clockReady: this._clock.ready,
        clockOffsetMs: Math.round(this._clock.offset || 0),
        match: this._match ? {
          seed: this._match.seed,
          mode: this._match.mode,
          running: this._phase === 'match' && !this._match.ended,
          ended: !!this._match.ended,
          myResult: this._match.myResult,
          peerResult: this._match.peerResult
        } : null
      };
    }

    /** 距离统一开跑还剩多少毫秒（<=0 表示已开跑；无对局返回 0） */
    timeToStart() {
      const mt = this._match;
      if (!mt || mt.ended) return 0;
      return Math.max(0, mt.startAtLocal - Date.now());
    }

    /* ---------- 连接三步曲 ---------- */

    /** 房主：创建房间，返回【邀请码】（发给对方） */
    async createRoom() {
      this._assertFree();
      this._role = 'host';
      this._link = new Link('host');
      this._bindLink();
      this._setPhase('hosting');
      return await this._link.createInvite();
    }

    /** 客人：粘贴【邀请码】，返回【回执码】（发回给房主） */
    async joinRoom(inviteCode) {
      this._assertFree();
      this._role = 'guest';
      this._link = new Link('guest');
      this._bindLink();
      this._setPhase('joining');
      return await this._link.joinWithInvite(inviteCode);
    }

    /** 房主：粘贴【回执码】，完成后双方触发 linkUp */
    async confirmRoom(replyCode) {
      if (this._role !== 'host' || !this._link) throw new PKVSError('BAD_STATE', '当前不是等待确认的房主状态');
      await this._link.confirmWithReply(replyCode);
    }

    /** 取消创建/加入，回到空闲 */
    cancel() {
      if (this._link) {
        const l = this._link;
        this._link = null;
        l.onClose = null;
        l.close('cancelled');
      }
      this._resetMatch();
      this._setPhase('idle');
    }

    /** 主动离开对局/断开连接 */
    leave() {
      if (this._link) {
        this._link.sendCtrl({ t: M.BYE });
        const l = this._link;
        setTimeout(() => l.close('bye'), 60);
      }
    }

    /* ---------- 对战流程 ---------- */

    /**
     * 房主发起对局。双方会收到 matchStart 事件（含同一随机种子，保证地图一致）。
     * @param {Object} opts
     * @param {number} opts.seed        地图随机种子（缺省自动生成）
     * @param {number} opts.countdownMs 统一倒计时毫秒，默认 3000
     * @param {string} opts.mode        胜负规则: 'race'(比用时,默认) | 'distance'(比距离) | 'score'(比分)
     * @param {Object} opts.options     透传给对方的任意自定义规则（赛道ID/道具开关等）
     */
    async startMatch(opts = {}) {
      if (this._role !== 'host') throw new PKVSError('NOT_HOST', '只有房主可以发起对局');
      if (!this._isUp()) throw new PKVSError('NOT_CONNECTED', '连接未建立');
      // 等时钟同步就绪（保证双方倒计时对齐），最多 2 秒
      const waited = Date.now();
      while (!this._clock.ready && Date.now() - waited < 2000 && this._isUp()) {
        await new Promise(r => setTimeout(r, 100));
      }
      const seed = (opts.seed != null) ? (opts.seed >>> 0) : (Math.random() * 4294967296) >>> 0;
      const countdownMs = clamp(opts.countdownMs != null ? opts.countdownMs : 3000, 500, 60000);
      const mode = opts.mode || 'race';
      const options = opts.options != null ? opts.options : null;
      const rtt = this._link ? (this._link.rtt || 120) : 120;
      // 开始时刻 = 房主当前钟 + 倒计时 + 单程传输余量，客人按钟偏换算
      const startAt = Date.now() + countdownMs + Math.min(rtt, 500);
      this._beginMatch(seed, startAt, countdownMs, mode, options);
      this._link.sendCtrl({ t: M.START, seed, sa: startAt, cd: countdownMs, m: mode, o: options });
    }

    /**
     * 游戏循环里高频调用：同步我方进度（自动节流到 stateHz，只发最新值）。
     * @param {Object} state 任意可序列化字段，如 { distance, speed, lane, slow }
     */
    sendProgress(state) {
      if (!this._isUp() || !this._match || this._match.ended) return false;
      this._pendingState = { t: M.STATE, ts: Date.now(), d: state };
      const now = performance.now();
      const minInt = 1000 / this._stateHz;
      const elapsed = now - this._lastSentAt;
      if (elapsed >= minInt) {
        this._flushState();
      } else if (this._flushTimer == null) {
        this._flushTimer = setTimeout(() => {
          this._flushTimer = null;
          this._flushState();
        }, minInt - elapsed);
      }
      return true;
    }

    /** 发送稀疏自定义事件（道具使用/干扰攻击等），可靠送达 */
    sendGameEvent(type, data) {
      if (!this._isUp()) return false;
      return this._link.sendCtrl({ t: M.EVENT, k: String(type).slice(0, 64), d: data == null ? null : data });
    }

    /**
     * 上报我方最终成绩（到达终点或死亡/弃赛时调用一次）。
     * @param {Object} res
     * @param {number} res.distance 最终距离
     * @param {number} res.score    最终得分
     * @param {number} res.timeMs   完赛用时（race 模式判胜依据；弃赛可为 null）
     * @param {boolean} res.dnf     是否未完成（true 则判负）
     */
    reportResult(res = {}) {
      const mt = this._match;
      if (!mt || mt.myResult || mt.ended) return false;
      mt.myResult = {
        distance: +res.distance || 0,
        score: +res.score || 0,
        timeMs: res.timeMs == null ? null : +res.timeMs,
        dnf: !!res.dnf
      };
      if (this._link) this._link.sendCtrl({ t: M.FINISH, d: mt.myResult });
      if (this._role === 'host') this._judge('finish');
      else this._armGuestFallback();
      return true;
    }

    /** 终局后请求再战；双方都请求后由房主自动开新局（沿用规则、换新种子） */
    requestRematch() {
      if (this._phase !== 'done' || !this._isUp()) return false;
      this._wantRematch = true;
      this._link.sendCtrl({ t: M.REMATCH });
      this._emit('rematchWait', { peerAsked: this._peerWantRematch });
      this._maybeRematch();
      return true;
    }

    /* ---------- 内部实现 ---------- */

    _assertFree() {
      if (this._link || (this._phase !== 'idle' && this._phase !== 'closed')) {
        throw new PKVSError('BUSY', '当前状态不能执行该操作，请先 cancel() 或 leave()');
      }
    }

    _isUp() { return !!(this._link && this._link.isUp()); }

    _setPhase(p) {
      this._phase = p;
      this._emit('phase', { phase: p });
    }

    _emit(type, extra) {
      try {
        this._onEvent(Object.assign({ type }, extra || {}));
      } catch (e) {
        console.error('[PKVS] onEvent handler error:', e);
      }
    }

    _bindLink() {
      const link = this._link;
      link.onOpen = () => {
        link.sendCtrl({ t: M.HELLO, n: this._name, v: PROTOCOL });
        this._setPhase('connected');
        this._emit('linkUp', { role: this._role });
      };
      link.onPong = (t0, t1, t3) => {
        this._clock.addSample(t0, t1, t3);
        // 把平滑后的 RTT 回写到链路层：clockReady 事件与 ageMs 估算都依赖它
        if (this._clock.rtt != null) link.rtt = Math.round(this._clock.rtt);
        if (this._clock.ready && !this._clockAnnounced) {
          this._clockAnnounced = true;
          this._emit('clockReady', { offsetMs: Math.round(this._clock.offset), rttMs: link.rtt });
        }
      };
      link.onMessage = (msg) => this._onMsg(msg);
      link.onClose = (reason) => this._onLinkClose(reason);
    }

    _onMsg(msg) {
      switch (msg.t) {
        case M.HELLO: {
          this._peerName = String(msg.n || 'Player').slice(0, 32);
          if (msg.v !== PROTOCOL) {
            this._emit('warning', { code: 'PROTOCOL', message: '对方插件协议版本不同（v' + msg.v + '），可能出现兼容问题' });
          }
          this._emit('peerHello', { name: this._peerName });
          break;
        }
        case M.START: {
          if (this._role !== 'guest') break;
          const startAtLocal = this._clock.toLocal(msg.sa); // 房主钟 → 本地钟
          this._beginMatch(msg.seed >>> 0, startAtLocal, msg.cd || 3000, msg.m || 'race', msg.o || null);
          break;
        }
        case M.STATE: {
          const ts = msg.ts || 0;
          let ageMs = null;
          if (ts) {
            const oneWay = (this._link && this._link.rtt ? this._link.rtt : 0) / 2;
            ageMs = Math.max(0, Date.now() - this._clock.toLocal(ts) - oneWay);
          }
          this._lastPeerAt = performance.now();   // 对端还活着（客人侧兜底判定要看它）
          this._emit('peerProgress', { state: msg.d || {}, ageMs });
          break;
        }
        case M.EVENT: {
          this._emit('peerEvent', { event: msg.k, data: msg.d });
          break;
        }
        case M.FINISH: {
          const mt = this._match;
          if (mt && !mt.peerResult) {
            mt.peerResult = msg.d || {};
            this._emit('peerResult', { result: mt.peerResult });
          }
          if (this._role === 'host') this._judge('finish');
          else this._armGuestFallback();
          break;
        }
        case M.RESULT: {
          const mt = this._match;
          if (mt && !mt.ended) {
            mt.ended = true;
            clearTimeout(this._fbTimer);
            this._finishMatch({
              winner: msg.w,
              reason: msg.reason || 'finish',
              results: msg.rs || null
            });
          }
          break;
        }
        case M.REMATCH: {
          this._peerWantRematch = true;
          this._emit('peerRematch', {});
          this._maybeRematch();
          break;
        }
        case M.BYE: {
          if (this._link) this._link.close('peer-bye');
          break;
        }
      }
    }

    _beginMatch(seed, startAtLocal, countdownMs, mode, options) {
      this._resetMatch();
      this._match = {
        seed, mode, options,
        startAtLocal,
        countdownMs,
        ended: false,
        myResult: null,
        peerResult: null
      };
      this._setPhase('match');
      this._emit('matchStart', {
        seed,
        startAtLocal,
        countdownMs,
        mode,
        options
      });
    }

    _flushState() {
      if (this._flushTimer) { clearTimeout(this._flushTimer); this._flushTimer = null; }
      if (!this._pendingState || !this._isUp()) return;
      this._lastSentAt = performance.now();
      this._link.sendState(this._pendingState);
      this._pendingState = null;
    }

    _judge(reason) {
      this._lastPeerAt = performance.now();
      const mt = this._match;
      if (!mt || mt.ended || mt.myResult == null || mt.peerResult == null) return;
      const hostRes = this._role === 'host' ? mt.myResult : mt.peerResult;
      const guestRes = this._role === 'host' ? mt.peerResult : mt.myResult;
      const w = judgeByMode(mt.mode, hostRes, guestRes);
      mt.ended = true;
      clearTimeout(this._fbTimer);
      const results = { host: hostRes, guest: guestRes };
      if (this._link) this._link.sendCtrl({ t: M.RESULT, w, rs: results, reason });
      this._finishMatch({ winner: w, reason, results });
    }

    /** 客人侧兜底：房主掉线/无响应时自行判定，避免卡死 */
    _armGuestFallback() {
      clearTimeout(this._fbTimer);
      this._fbTimer = setTimeout(() => {
        const mt = this._match;
        if (!mt || mt.ended || this._role !== 'guest') return;
        // 对端还在推进（链路通、4 秒内还有进度帧）说明它只是还没跑完，不能抢判：
        // 「我先撞死了、对方继续跑到终点」是常见情况，12 秒兜底会把它误判成平局。
        if (this._isUp() && performance.now() - (this._lastPeerAt || 0) < 4000) {
          this._armGuestFallback();
          return;
        }
        const my = mt.myResult || { dnf: true };
        const peer = mt.peerResult || { dnf: true };
        const w = judgeByMode(mt.mode, peer, my); // 参数顺序: host, guest —— 我是 guest
        mt.ended = true;
        this._finishMatch({
          winner: w,
          reason: 'fallback',
          results: { host: peer, guest: my }
        });
      }, GUEST_FALLBACK_MS);
    }

    _finishMatch(outcome) {
      this._setPhase('done');
      this._emit('matchEnd', {
        winner: outcome.winner,          // 'host' | 'guest' | 'draw'
        reason: outcome.reason,          // finish | fallback | disconnect
        you: this._role,
        iWin: outcome.winner === this._role,
        draw: outcome.winner === 'draw',
        results: outcome.results || null // { host: {...}, guest: {...} }
      });
    }

    _maybeRematch() {
      if (this._role !== 'host' || this._phase !== 'done') return;
      if (this._wantRematch && this._peerWantRematch && this._isUp()) {
        const prev = this._match || {};
        this._wantRematch = this._peerWantRematch = false;
        this.startMatch({ mode: prev.mode, options: prev.options, countdownMs: prev.countdownMs })
          .catch(err => this._emit('error', { code: err.code || 'REMATCH', message: err.message }));
      }
    }

    _onLinkClose(reason) {
      const inUnfinishedMatch = this._phase === 'match' && this._match && !this._match.ended;
      this._link = null;
      this._clockAnnounced = false;
      this._peerName = null;
      clearTimeout(this._fbTimer);
      if (inUnfinishedMatch) {
        // 对方断线/退出 → 我方判胜（各自视角；详见 README"断线判定"）
        this._match.ended = true;
        this._finishMatch({ winner: this._role, reason: 'disconnect', results: null });
      }
      this._setPhase('closed');
      this._emit('linkDown', { reason: reason || 'unknown' });
    }

    _resetMatch() {
      clearTimeout(this._fbTimer);
      this._match = null;
      this._wantRematch = this._peerWantRematch = false;
      if (this._flushTimer) { clearTimeout(this._flushTimer); this._flushTimer = null; }
      this._pendingState = null;
    }
  }

  /* ==================== 导出 ==================== */
  ParkourVS.version = VERSION;
  ParkourVS.isSupported = typeof RTCPeerConnection !== 'undefined';
  ParkourVS.compressionSupported = canCompress;
  ParkourVS.PKVSError = PKVSError;

  global.PKVS = ParkourVS;
  if (typeof module !== 'undefined' && module.exports) module.exports = ParkourVS;

})(typeof window !== 'undefined' ? window : this);
