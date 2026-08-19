import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './contexts/AuthContext'

// Private, single-user deployment: no marketing landing page, pricing,
// account or login views — the Clip Generator is the only screen. AuthContext
// is kept as a provider because App.jsx still reads a few fields off it
// (billingEnabled, isSignedIn, etc.); it stays inert since billingEnabled is
// always false with the cloud/ package removed from the backend.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
)
