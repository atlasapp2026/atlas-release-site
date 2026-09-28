'use strict'

const SUPABASE_URL =
  'https://pknerqimxrdieeaocixs.supabase.co'

const SUPABASE_PUBLISHABLE_KEY =
  'sb_publishable_tIB5IOIbBN9zLJILuqyqJg_aO956pAH'

const DELETE_FUNCTION_NAME =
  'delete-atlas-account'

const MAX_EMAIL_LENGTH = 320
const REQUEST_TIMEOUT_MS = 20000

const elements = Object.freeze({
  email:
    document.getElementById('email'),

  requestCode:
    document.getElementById('request-code'),

  verificationStep:
    document.getElementById('verification-step'),

  otp:
    document.getElementById('otp'),

  verifyCode:
    document.getElementById('verify-code'),

  deleteStep:
    document.getElementById('delete-step'),

  confirmation:
    document.getElementById('confirmation'),

  deleteAccount:
    document.getElementById('delete-account'),

  startOver:
    document.getElementById('start-over'),

  status:
    document.getElementById('status'),
})

let busy = false
let verificationRequested = false
let accessToken = null
let verifiedEmail = null
let deleted = false

function setStatus(
  message,
  kind = 'normal',
) {
  elements.status.textContent = message
  elements.status.className = 'status'

  if (!message) {
    return
  }

  elements.status.classList.add('visible')

  if (kind === 'error') {
    elements.status.classList.add('error')
  }

  if (kind === 'success') {
    elements.status.classList.add('success')
  }
}

function normalizedEmail() {
  return elements.email.value.trim()
}

function validEmail(email) {
  return (
    email.length > 2 &&
    email.length <= MAX_EMAIL_LENGTH &&
    email.includes('@') &&
    !email.startsWith('@') &&
    !email.endsWith('@')
  )
}

function validOtp(code) {
  return /^[0-9]{6}$/.test(code)
}

function updateControls() {
  elements.email.disabled =
    busy ||
    verificationRequested ||
    deleted

  elements.requestCode.disabled =
    busy ||
    verificationRequested ||
    deleted

  elements.otp.disabled =
    busy ||
    !verificationRequested ||
    Boolean(accessToken) ||
    deleted

  elements.verifyCode.disabled =
    busy ||
    !verificationRequested ||
    Boolean(accessToken) ||
    deleted

  elements.confirmation.disabled =
    busy ||
    !accessToken ||
    deleted

  elements.deleteAccount.disabled =
    busy ||
    !accessToken ||
    deleted ||
    elements.confirmation.value.trim() !== 'DELETE'

  elements.startOver.disabled =
    busy ||
    deleted
}

function resetFlow({
  preserveStatus = false,
} = {}) {
  accessToken = null
  verifiedEmail = null
  verificationRequested = false

  elements.email.disabled = false
  elements.otp.value = ''
  elements.confirmation.value = ''

  elements.verificationStep.hidden = true
  elements.deleteStep.hidden = true

  if (!preserveStatus) {
    setStatus('')
  }

  updateControls()
}

function setBusy(value) {
  busy = value
  updateControls()
}

async function readJsonResponse(response) {
  const text = await response.text()

  if (!text) {
    return {}
  }

  try {
    return JSON.parse(text)
  } catch {
    return {}
  }
}

async function postJson(
  path,
  body,
  authorization = null,
) {
  const controller =
    new AbortController()

  const timeoutId = setTimeout(
    () => {
      controller.abort()
    },
    REQUEST_TIMEOUT_MS,
  )

  const headers = {
    apikey:
      SUPABASE_PUBLISHABLE_KEY,

    'content-type':
      'application/json',
  }

  if (authorization) {
    headers.authorization =
      'Bearer ' + authorization
  }

  try {
    return await fetch(
      SUPABASE_URL + path,
      {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      },
    )
  } finally {
    clearTimeout(timeoutId)
  }
}

async function requestCode() {
  if (busy || deleted) {
    return
  }

  const email =
    normalizedEmail()

  if (!validEmail(email)) {
    setStatus(
      'Enter a valid Atlas account email address.',
      'error',
    )

    elements.email.focus()
    return
  }

  accessToken = null
  verifiedEmail = null

  setBusy(true)

  setStatus(
    'Requesting verification code...',
  )

  try {
    const response = await postJson(
      '/auth/v1/otp',
      {
        email,
        data: {},
        create_user: false,
        gotrue_meta_security: {},
      },
    )

    await readJsonResponse(response)

    if (response.status === 429) {
      throw new Error(
        'Too many verification requests. Please wait before trying again.',
      )
    }

    if (response.status >= 500) {
      throw new Error(
        'Atlas verification is temporarily unavailable. Please try again later.',
      )
    }

    /*
     * Do not reveal whether an Atlas account exists for a supplied
     * email address. Existing-account verification will continue below.
     */
    verificationRequested = true

    elements.email.value = email
    elements.verificationStep.hidden = false
    elements.otp.value = ''

    setStatus(
      'If this email belongs to an eligible Atlas account, a verification code has been sent.',
    )

    updateControls()
    elements.otp.focus()
  } catch (error) {
    const message = (
      error instanceof Error &&
      error.name === 'AbortError'
    )
      ? 'The verification request timed out. Please try again.'
      : (
        error instanceof Error &&
        error.message
      )
        ? error.message
        : 'Atlas could not request a verification code.'

    setStatus(
      message,
      'error',
    )
  } finally {
    setBusy(false)
  }
}

async function verifyCode() {
  if (
    busy ||
    deleted ||
    !verificationRequested
  ) {
    return
  }

  const email =
    normalizedEmail()

  const code =
    elements.otp.value.trim()

  if (!validEmail(email)) {
    resetFlow({
      preserveStatus: true,
    })

    setStatus(
      'Restart verification with a valid Atlas account email.',
      'error',
    )

    elements.email.focus()
    return
  }

  if (!validOtp(code)) {
    setStatus(
      'Enter the six-digit verification code.',
      'error',
    )

    elements.otp.focus()
    return
  }

  accessToken = null
  verifiedEmail = null

  setBusy(true)

  setStatus(
    'Verifying code...',
  )

  try {
    const response = await postJson(
      '/auth/v1/verify',
      {
        type: 'email',
        email,
        token: code,
      },
    )

    const payload =
      await readJsonResponse(response)

    if (!response.ok) {
      throw new Error(
        'The verification code is invalid or expired. Start over and request a new code if needed.',
      )
    }

    const token = (
      typeof payload.access_token === 'string'
    )
      ? payload.access_token.trim()
      : ''

    const returnedEmail = (
      payload.user &&
      typeof payload.user.email === 'string'
    )
      ? payload.user.email.trim()
      : ''

    if (!token) {
      throw new Error(
        'Atlas did not receive an authenticated deletion session.',
      )
    }

    if (
      returnedEmail &&
      returnedEmail.toLowerCase() !==
        email.toLowerCase()
    ) {
      throw new Error(
        'Verification resolved to a different Atlas account.',
      )
    }

    accessToken = token
    verifiedEmail = email

    elements.otp.value = ''
    elements.deleteStep.hidden = false

    setStatus(
      'Email verified. Type DELETE exactly to confirm permanent cloud account deletion.',
    )

    updateControls()
    elements.confirmation.focus()
  } catch (error) {
    accessToken = null
    verifiedEmail = null

    const message = (
      error instanceof Error &&
      error.name === 'AbortError'
    )
      ? 'Verification timed out. Start over and request a new code.'
      : (
        error instanceof Error &&
        error.message
      )
        ? error.message
        : 'Atlas could not verify the deletion code.'

    setStatus(
      message,
      'error',
    )
  } finally {
    setBusy(false)
  }
}

async function deleteAccount() {
  if (
    busy ||
    deleted ||
    !accessToken ||
    !verifiedEmail
  ) {
    return
  }

  if (
    elements.confirmation.value.trim() !==
    'DELETE'
  ) {
    setStatus(
      'Type DELETE exactly before deleting the account.',
      'error',
    )

    elements.confirmation.focus()
    return
  }

  setBusy(true)

  setStatus(
    'Deleting Atlas cloud account...',
  )

  try {
    const response = await postJson(
      '/functions/v1/' +
        DELETE_FUNCTION_NAME,
      {
        confirmation: 'DELETE',
      },
      accessToken,
    )

    const payload =
      await readJsonResponse(response)

    if (
      response.status === 401 ||
      response.status === 403
    ) {
      accessToken = null
      verifiedEmail = null

      resetFlow({
        preserveStatus: true,
      })

      throw new Error(
        'The secure deletion verification expired. Request a new code and try again.',
      )
    }

    if (
      !response.ok ||
      payload.status !== 'deleted' ||
      payload.localDataRetained !== true
    ) {
      const serverMessage = (
        typeof payload.error === 'string' &&
        payload.error.length <= 500
      )
        ? payload.error
        : ''

      throw new Error(
        serverMessage ||
        'Atlas could not complete account deletion.',
      )
    }

    accessToken = null
    verifiedEmail = null
    deleted = true

    elements.confirmation.value = ''

    setStatus(
      'Your Atlas cloud account has been deleted. Local Atlas data on your devices was not remotely erased.',
      'success',
    )

    updateControls()
  } catch (error) {
    const message = (
      error instanceof Error &&
      error.name === 'AbortError'
    )
      ? 'The deletion request timed out. Your deletion status could not be confirmed. Do not repeatedly submit the request; start a new verified session before retrying.'
      : (
        error instanceof Error &&
        error.message
      )
        ? error.message
        : 'Atlas could not complete account deletion.'

    setStatus(
      message,
      'error',
    )
  } finally {
    busy = false
    updateControls()
  }
}

elements.requestCode.addEventListener(
  'click',
  requestCode,
)

elements.verifyCode.addEventListener(
  'click',
  verifyCode,
)

elements.confirmation.addEventListener(
  'input',
  updateControls,
)

elements.deleteAccount.addEventListener(
  'click',
  deleteAccount,
)

elements.startOver.addEventListener(
  'click',
  () => {
    resetFlow()
    elements.email.focus()
  },
)

elements.otp.addEventListener(
  'input',
  () => {
    elements.otp.value =
      elements.otp.value
        .replace(/[^0-9]/g, '')
        .slice(0, 6)
  },
)

window.addEventListener(
  'pagehide',
  () => {
    accessToken = null
    verifiedEmail = null
  },
  {
    once: true,
  },
)

resetFlow()