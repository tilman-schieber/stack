import React, { useEffect, useRef, useState } from 'react'
import { useEngineGame } from '../../store/engineGame.js'
import { EXAMPLE_DECKS } from '../../lib/exampleDecks.js'
import { resolvePlayableDeck } from '../../lib/resolveDeck.js'
import { WebrtcTransport } from '../../net/webrtcTransport.js'
import DeckPicker from './DeckPicker.jsx'

// Serverless peer-to-peer connection setup by copy-pasting one code each way.
//   Host: pick a deck -> "Create game" -> copy the offer code to your friend ->
//         paste the answer code they send back -> "Connect".
//   Join: pick a deck -> paste the host's offer code -> "Generate answer" ->
//         copy your answer code back to the host.
// When the data channel opens the store builds/starts the game and PlayArea swaps
// to the board (via `started`), unmounting this component.
export default function NetworkSetup({ role }) {
  const hostGame = useEngineGame((s) => s.hostGame)
  const guestGame = useEngineGame((s) => s.guestGame)
  const endGame = useEngineGame((s) => s.endGame)
  const [deck, setDeck] = useState(`example:${EXAMPLE_DECKS[0].slug}`)
  const [myCode, setMyCode] = useState('') // code to hand to the other player
  const [theirCode, setTheirCode] = useState('') // code pasted from the other player
  const [phase, setPhase] = useState('idle') // idle | working | waiting | connecting
  const [error, setError] = useState('')
  const transportRef = useRef(null)
  const notice = useEngineGame((s) => s.notice)

  const fail = (err) => {
    setError(err.message || String(err))
    setPhase('idle')
  }

  // The store ends the session (peer cancelled / connection dropped) while we're
  // still in setup: fall back to the start and show why.
  useEffect(() => {
    if (!notice) return
    transportRef.current = null
    setMyCode('')
    setTheirCode('')
    setPhase('idle')
    setError(notice)
    useEngineGame.getState().clearNotice() // consumed here; don't show it again on the setup screen
  }, [notice])

  // HOST: create the offer code and start listening for the guest.
  async function createOffer() {
    setError('')
    setPhase('working')
    try {
      const myDeck = await resolvePlayableDeck(deck)
      const t = new WebrtcTransport()
      transportRef.current = t
      const code = await t.createOffer()
      hostGame({ myDeck, transport: t }) // installs message handlers; game starts on the guest's deck
      setMyCode(code)
      setPhase('waiting') // waiting for the answer code to be pasted
    } catch (err) {
      fail(err)
    }
  }

  // HOST: finish the connection with the guest's answer code.
  async function acceptAnswer() {
    setError('')
    setPhase('connecting')
    try {
      await transportRef.current.acceptAnswer(theirCode)
    } catch (err) {
      fail(err)
    }
  }

  // JOIN: consume the host's offer code and produce our answer code.
  async function generateAnswer() {
    setError('')
    setPhase('working')
    try {
      const myDeck = await resolvePlayableDeck(deck)
      const t = new WebrtcTransport()
      transportRef.current = t
      const code = await t.acceptOffer(theirCode)
      guestGame({ myDeck, transport: t }) // sends our deck when the channel opens
      setMyCode(code)
      setPhase('connecting') // once the host applies our answer, the game view arrives
    } catch (err) {
      fail(err)
    }
  }

  const deckSelect = <DeckPicker label="Your deck" value={deck} onChange={setDeck} disabled={phase !== 'idle'} />

  const codeBox = (label, value, readOnly, onChange) => (
    <>
      <label className="field-label">{label}</label>
      <textarea
        className="net-code"
        rows={3}
        value={value}
        readOnly={readOnly}
        placeholder={readOnly ? '' : 'Paste the code here'}
        onChange={onChange ? (ev) => onChange(ev.target.value) : undefined}
        onFocus={readOnly ? (ev) => ev.target.select() : undefined}
      />
    </>
  )

  return (
    <div className="net-setup">
      <p className="muted" style={{ marginTop: 0 }}>
        Serverless peer-to-peer — no account, no server. Share the connection code with your friend over
        any chat.
      </p>
      {deckSelect}

      {role === 'host' && (
        <>
          {phase === 'idle' && (
            <button className="primary" onClick={createOffer}>
              Create game
            </button>
          )}
          {phase === 'working' && <p className="muted">Generating your code…</p>}
          {(phase === 'waiting' || phase === 'connecting') && (
            <>
              {codeBox('1. Send this code to your friend', myCode, true)}
              {codeBox('2. Paste the answer code they send back', theirCode, false, setTheirCode)}
              <button className="primary" onClick={acceptAnswer} disabled={!theirCode || phase === 'connecting'}>
                {phase === 'connecting' ? 'Connecting…' : 'Connect'}
              </button>
            </>
          )}
        </>
      )}

      {role === 'join' && (
        <>
          {phase === 'idle' && (
            <>
              {codeBox("1. Paste the host's code", theirCode, false, setTheirCode)}
              <button className="primary" onClick={generateAnswer} disabled={!theirCode}>
                Generate answer
              </button>
            </>
          )}
          {phase === 'working' && <p className="muted">Generating your code…</p>}
          {phase === 'connecting' && (
            <>
              {codeBox('2. Send this answer code back to the host', myCode, true)}
              <p className="muted">Waiting for the host to connect…</p>
            </>
          )}
        </>
      )}

      {error && <div className="search-error">{error}</div>}
      {phase !== 'idle' && (
        <button
          className="mini"
          onClick={() => {
            endGame() // no reason: a deliberate cancel needs no notice
            transportRef.current = null
            setMyCode('')
            setTheirCode('')
            setPhase('idle')
            setError('')
          }}
        >
          Cancel
        </button>
      )}
    </div>
  )
}
