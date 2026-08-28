// Serverless WebRTC transport for peer-to-peer play. One reliable, ordered
// RTCDataChannel between two peers, established by copy-pasting a single connection
// code each way (vanilla ICE: we wait for gathering to finish so the code carries
// the SDP *and* all candidates, so no signaling server is needed).
//
// Host flow:  const t = new WebrtcTransport(); const offer = await t.createOffer()
//             ...share `offer`, receive the guest's answer...  await t.acceptAnswer(answer)
// Guest flow: const t = new WebrtcTransport(); const answer = await t.acceptOffer(offer)
//             ...share `answer` back to the host...
// Both: assign t.onOpen / t.onMessage / t.onClose; call t.send(obj); t.close().

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }]

const encode = (obj) => btoa(unescape(encodeURIComponent(JSON.stringify(obj))))
const decode = (code) => JSON.parse(decodeURIComponent(escape(atob(code.trim()))))

export class WebrtcTransport {
  constructor() {
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    this.channel = null
    this.onOpen = null
    this.onMessage = null
    this.onClose = null
    this.pc.onconnectionstatechange = () => {
      const st = this.pc.connectionState
      if ((st === 'disconnected' || st === 'failed' || st === 'closed') && this.onClose) this.onClose(st)
    }
  }

  // Resolve once ICE gathering is complete, so the local description we emit
  // already contains every candidate (non-trickle / vanilla ICE). Gathering can
  // stall when the STUN server is unreachable, so after `timeoutMs` we go with
  // whatever candidates we have (enough for a LAN) — or fail with a clear message.
  _localDescriptionWhenReady(timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const done = () => {
        this.pc.removeEventListener('icegatheringstatechange', check)
        clearTimeout(timer)
        const desc = this.pc.localDescription
        if (desc && /a=candidate:/.test(desc.sdp)) resolve(desc)
        else reject(new Error('Could not find a network route (no connection candidates). Check your network and try again.'))
      }
      const check = () => this.pc.iceGatheringState === 'complete' && done()
      const timer = setTimeout(done, timeoutMs)
      this.pc.addEventListener('icegatheringstatechange', check)
      check()
    })
  }

  _bindChannel(ch) {
    this.channel = ch
    ch.onopen = () => this.onOpen && this.onOpen()
    ch.onclose = () => this.onClose && this.onClose('closed')
    ch.onmessage = (ev) => {
      if (!this.onMessage) return
      try {
        this.onMessage(JSON.parse(ev.data))
      } catch {
        /* ignore malformed frames */
      }
    }
  }

  // HOST: create the offer code to share with the guest.
  async createOffer() {
    this._bindChannel(this.pc.createDataChannel('game', { ordered: true }))
    await this.pc.setLocalDescription(await this.pc.createOffer())
    return encode(await this._localDescriptionWhenReady())
  }

  // HOST: apply the guest's answer code to finish connecting.
  async acceptAnswer(code) {
    await this.pc.setRemoteDescription(decode(code))
  }

  // GUEST: apply the host's offer code and return the answer code to send back.
  async acceptOffer(code) {
    this.pc.ondatachannel = (ev) => this._bindChannel(ev.channel)
    await this.pc.setRemoteDescription(decode(code))
    await this.pc.setLocalDescription(await this.pc.createAnswer())
    return encode(await this._localDescriptionWhenReady())
  }

  send(obj) {
    if (this.channel?.readyState === 'open') this.channel.send(JSON.stringify(obj))
  }

  close() {
    try {
      this.channel?.close()
      this.pc.close()
    } catch {
      /* already closed */
    }
  }
}
