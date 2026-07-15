import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './theme' // applies the saved/system theme before first paint
import './font' // applies the saved font before first paint
import './accent' // applies the saved accent colour before first paint
import './density' // applies the saved density before first paint
import 'katex/dist/katex.min.css' // maths rendering styles (bundled, no network)
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
