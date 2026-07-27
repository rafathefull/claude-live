import { createApp } from 'vue'
import App from './App.vue'
import './styles.css'
import { connect } from './store'
import { startReplayEngine } from './replay'
import { applyTheme } from './theme'

// Antes de montar: si no, el primer fotograma sale con el tema oscuro y da un fogonazo.
applyTheme()
connect()
startReplayEngine()
createApp(App).mount('#app')
