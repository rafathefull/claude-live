import { createApp } from 'vue'
import App from './App.vue'
import './styles.css'
import { connect } from './store'
import { startReplayEngine } from './replay'

connect()
startReplayEngine()
createApp(App).mount('#app')
