import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { cellToBoundary } from 'h3-js'

function isFinitePair(pt) {
  return Array.isArray(pt) && pt.length === 2 && Number.isFinite(pt[0]) && Number.isFinite(pt[1])
}

function validateCell(cell) {
  try {
    const ring = cellToBoundary(cell, 'geojson')
    if (!Array.isArray(ring) || ring.length < 3) return { ok: false, reason: 'ring-too-short' }
    const filtered = ring.filter(isFinitePair)
    if (filtered.length !== ring.length) return { ok: false, reason: 'non-finite-coords' }
    const first = filtered[0]
    const last = filtered[filtered.length - 1]
    const isClosed = last[0] === first[0] && last[1] === first[1]
    return { ok: true, isClosed }
  } catch (e) {
    return { ok: false, reason: 'exception:' + (e && e.message ? e.message : String(e)) }
  }
}

function main() {
  const arg = process.argv[2]
  let data = null
  if (arg) {
    const p = resolve(process.cwd(), arg)
    const raw = readFileSync(p, 'utf-8')
    data = JSON.parse(raw)
  } else if (existsSync(resolve(process.cwd(), 'cells.json'))) {
    const raw = readFileSync(resolve(process.cwd(), 'cells.json'), 'utf-8')
    data = JSON.parse(raw)
  } else {
    data = [
      { cell: '852664c3fffffff', value: 2.9281 },
      { cell: '85268cdbfffffff', value: 2.8894444444444445 },
      { cell: '8928308280fffff', value: 1.2 },
      { cell: '8928308280bffff', value: 2.8 },
      { cell: '8928308280dffff', value: 4.5 },
    ]
  }

  let ok = 0
  let closed = 0
  let bad = 0
  const issues = []

  for (const item of data) {
    const cell = item.cell || item.h3Index || item.index || item.h3 || item.hex || item.id
    if (!cell) {
      bad++
      issues.push({ item, reason: 'missing-cell' })
      continue
    }
    const res = validateCell(cell)
    if (res.ok) {
      ok++
      if (res.isClosed) closed++
    } else {
      bad++
      issues.push({ cell, reason: res.reason })
    }
  }

  console.log(`Validated ${data.length} items -> ok=${ok}, closed=${closed}, bad=${bad}`)
  if (issues.length) {
    console.log('Issues:', JSON.stringify(issues.slice(0, 10), null, 2))
  }
}

main()
