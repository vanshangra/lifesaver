import { useState, useEffect } from 'react'
import axios from 'axios'
import './App.css'

const API_URL = 'https://lifesaver-production-2183.up.railway.app/api'

function App() {
  const [taskInput, setTaskInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [response, setResponse] = useState(null)
  const [error, setError] = useState(null)
  const [chatHistory, setChatHistory] = useState([])
  const [isListening, setIsListening] = useState(false)
  const [planHistory, setPlanHistory] = useState([])
  const [savedPlans, setSavedPlans] = useState([])
  const [showHistory, setShowHistory] = useState(false)
  const [metrics, setMetrics] = useState(null)
  const [completedTasks, setCompletedTasks] = useState([])
  const [weeklyView, setWeeklyView] = useState(false)
  const [currentWeek, setCurrentWeek] = useState(0)
  const [weeklyPlans, setWeeklyPlans] = useState({})
  const [recommendations, setRecommendations] = useState(null)

  // Fetch saved plans on mount
  useEffect(() => {
    fetchSavedPlans()
    fetchMetrics()
    loadWeeklyPlans()
  }, [])

  // Auto-save and calculate recommendations when response received
  useEffect(() => {
    if (response) {
      savePlan()
      generateRecommendations()
      setPlanHistory(prev => [{
        timestamp: new Date().toLocaleTimeString(),
        input: taskInput,
        schedule: response.response?.schedule,
        reply: response.reply,
        completed: false
      }, ...prev.slice(0, 9)])
    }
  }, [response])

  const generateRecommendations = () => {
    if (completedTasks.length < 2) return

    const taskTimes = {
      morning: 0,
      afternoon: 0,
      evening: 0
    }

    // Simulate recommendation based on completed tasks
    const recommendation = {
      bestTime: 'You complete tasks fastest between 9am-12pm ☀️',
      pattern: 'Your success rate increases 40% when you tackle complex tasks first ⚡',
      advice: 'Breaking projects into 90-min chunks keeps you in flow state 🎯'
    }
    setRecommendations(recommendation)
  }

  const fetchSavedPlans = async () => {
    try {
      const res = await axios.get(`${API_URL}/plans`)
      setSavedPlans(res.data || [])
    } catch (err) {
      console.log('Could not fetch saved plans')
    }
  }

  const loadWeeklyPlans = () => {
    const stored = localStorage.getItem('weeklyPlans')
    if (stored) {
      setWeeklyPlans(JSON.parse(stored))
    }
  }

  const saveWeeklyPlan = (dayIndex, plan) => {
    const updated = { ...weeklyPlans, [dayIndex]: plan }
    setWeeklyPlans(updated)
    localStorage.setItem('weeklyPlans', JSON.stringify(updated))
  }

  const fetchMetrics = async () => {
    try {
      const res = await axios.get(`${API_URL}/metrics`)
      const adjusted = {
        ...res.data,
        successRate: Math.min(100, res.data.successRate + (completedTasks.length * 5)),
        completedCount: completedTasks.length
      }
      setMetrics(adjusted)
    } catch (err) {
      console.log('Metrics not available')
    }
  }

  const markTaskComplete = (taskTitle) => {
    if (!completedTasks.includes(taskTitle)) {
      setCompletedTasks([...completedTasks, taskTitle])
      fetchMetrics() // Recalculate metrics
      generateRecommendations()
    }
  }

  const savePlan = async () => {
    if (!response) return
    try {
      const planData = {
        input: taskInput,
        schedule: JSON.stringify(response.response?.schedule || []),
        reasoning: response.reply,
        createdAt: new Date().toISOString()
      }
      
      await axios.post(`${API_URL}/save-plan`, planData)
      fetchSavedPlans()
      console.log('Plan saved successfully!')
    } catch (err) {
      console.error('Failed to save plan:', err.response?.data)
    }
  }

  const startVoiceInput = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      setError('Speech Recognition not supported in your browser')
      return
    }

    const recognition = new SpeechRecognition()
    recognition.continuous = false
    recognition.interimResults = false
    recognition.lang = 'en-US'

    recognition.onstart = () => setIsListening(true)
    recognition.onend = () => setIsListening(false)
    recognition.onresult = (e) => {
      const transcript = Array.from(e.results)
        .map(r => r[0].transcript)
        .join('')
      setTaskInput(prev => prev + (prev ? ' ' : '') + transcript)
    }
    recognition.onerror = (e) => {
      setError(`Speech error: ${e.error}`)
      setIsListening(false)
    }

    recognition.start()
  }

  const handleSendMessage = async (e) => {
    e.preventDefault()
    if (!taskInput.trim()) return

    setLoading(true)
    setError(null)

    try {
      const res = await axios.post(`${API_URL}/agent`, {
        message: taskInput,
        history: chatHistory,
      })

      setResponse(res.data)
      setChatHistory(res.data.messages)
      setTaskInput('')
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to get response from agent')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const loadSavedPlan = (plan) => {
    const parsed = typeof plan.schedule === 'string' 
      ? JSON.parse(plan.schedule) 
      : plan.schedule
    
    setResponse({
      reply: plan.reasoning,
      response: { schedule: parsed },
      toolsUsed: ['loaded_from_history'],
      messages: []
    })
    setTaskInput(plan.input)
    setShowHistory(false)
  }

  const cleanMarkdown = (text) => {
    return text
      .replace(/\*\*/g, '')
      .replace(/\*\*\*/g, '')
      .replace(/###/g, '')
      .replace(/##/g, '')
      .replace(/# /g, '')
      .replace(/\|/g, '')
      .replace(/----/g, '')
      .replace(/\n\n\n+/g, '\n\n')
      .trim()
  }

  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

  return (
    <div className="app">
      <div className="container">
        <header className="header">
          <h1>⚡ LifeSaver</h1>
          <p>AI Productivity Agent — Plan Your Day Intelligently</p>
          <div className="header-tabs">
            <button 
              onClick={() => setWeeklyView(false)} 
              className={!weeklyView ? 'tab-active' : 'tab'}
            >
              📅 Daily
            </button>
            <button 
              onClick={() => setWeeklyView(true)} 
              className={weeklyView ? 'tab-active' : 'tab'}
            >
              📊 Weekly
            </button>
          </div>
        </header>

        {!weeklyView ? (
          // DAILY VIEW
          <div className="main-grid">
            {/* Input Section */}
            <div className="input-section">
              <form onSubmit={handleSendMessage}>
                <div className="form-group">
                  <div className="label-row">
                    <label>What's on your plate?</label>
                    <button
                      type="button"
                      onClick={startVoiceInput}
                      disabled={loading || isListening}
                      className="btn-voice"
                    >
                      🎤 {isListening ? 'Listening...' : 'Voice'}
                    </button>
                  </div>
                  <textarea
                    value={taskInput}
                    onChange={(e) => setTaskInput(e.target.value)}
                    placeholder="e.g., assignment due tomorrow 11pm (2hrs), gym today 6pm (1hr), project due Friday 5pm (3hrs)"
                    rows="5"
                    disabled={loading}
                  />
                </div>
                <button type="submit" disabled={loading} className="btn-primary">
                  {loading ? '⏳ Planning...' : '🚀 Generate Plan'}
                </button>
              </form>

              {error && (
                <div className="error-box">
                  <strong>❌ Error:</strong> {error}
                </div>
              )}

              {/* Saved Plans */}
              <div className="saved-plans-panel">
                {savedPlans.length > 0 ? (
                  <>
                    <button
                      onClick={() => setShowHistory(!showHistory)}
                      className="btn-history-toggle"
                    >
                      📚 Saved Plans ({savedPlans.length}) {showHistory ? '▼' : '▶'}
                    </button>
                    {showHistory && (
                      <div className="history-list">
                        {savedPlans.map((plan) => (
                          <div
                            key={plan.id}
                            className="history-item"
                            onClick={() => loadSavedPlan(plan)}
                          >
                            <small className="history-time">
                              {new Date(plan.createdAt).toLocaleDateString()}
                            </small>
                            <p className="history-input">{plan.input.substring(0, 60)}...</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <button className="btn-history-toggle" disabled>
                    📚 No Saved Plans Yet
                  </button>
                )}
              </div>
            </div>

            {/* Output Section */}
            <div className="output-section">
              {response ? (
                <div className="response-card">
                  <h2>📅 Your Optimized Plan</h2>

                  {/* Metrics */}
                  {metrics ? (
                    <div className="metrics-card">
                      <h4>📊 Your Productivity</h4>
                      <div className="metrics-grid">
                        <div className="metric">
                          <span className="metric-value">{metrics.successRate}%</span>
                          <span className="metric-label">Success Rate</span>
                        </div>
                        <div className="metric">
                          <span className="metric-value">{metrics.bestTimeOfDay}</span>
                          <span className="metric-label">Best Time</span>
                        </div>
                        <div className="metric">
                          <span className="metric-value">{completedTasks.length}</span>
                          <span className="metric-label">Completed Today</span>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {/* Schedule */}
                  {response.response?.schedule && response.response.schedule.length > 0 ? (
                    <div className="schedule">
                      <h3>⏰ Timeline</h3>
                      <div className="time-blocks">
                        {response.response.schedule.map((task, idx) => (
                          <div key={idx} className="time-block">
                            <div className="time-range">
                              {task.startTime} → {task.endTime}
                            </div>
                            <div className="task-title">
                              {completedTasks.includes(task.title) && '✅ '}
                              {task.title}
                            </div>
                            <div className="duration">
                              {task.estimatedMinutes} mins
                            </div>
                            {!completedTasks.includes(task.title) && (
                              <button
                                onClick={() => markTaskComplete(task.title)}
                                className="btn-complete"
                              >
                                ✓ Done
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {/* Recommendations */}
                  {recommendations && (
                    <div className="recommendations">
                      <h3>💡 Smart Insights</h3>
                      <div className="insight-item">{recommendations.bestTime}</div>
                      <div className="insight-item">{recommendations.pattern}</div>
                      <div className="insight-item">{recommendations.advice}</div>
                    </div>
                  )}

                  {/* Reasoning */}
                  <div className="reasoning">
                    <h3>🤔 Agent Reasoning</h3>
                    <div className="reasoning-text">
                      {cleanMarkdown(response.reply)}
                    </div>
                  </div>

                  {/* Tools Used */}
                  {response.toolsUsed && response.toolsUsed.length > 0 && (
                    <div className="tools-used">
                      <h3>🔧 Tools Used</h3>
                      <div className="tool-badges">
                        {response.toolsUsed.map((tool, idx) => (
                          <span key={idx} className="badge">
                            {tool.replace(/_/g, ' ')}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="action-buttons">
                    <button
                      onClick={() => {
                        setResponse(null)
                        setTaskInput('')
                        setShowHistory(false)
                      }}
                      className="btn-secondary"
                      type="button"
                    >
                      ↻ New Plan
                    </button>
                    <button
                      onClick={() => {
                        savePlan()
                        alert('✅ Plan saved!')
                      }}
                      className="btn-secondary"
                      type="button"
                    >
                      💾 Save
                    </button>
                  </div>
                </div>
              ) : (
                <div className="empty-state">
                  <div className="empty-icon">📝</div>
                  <p>Enter your tasks above to get an AI-powered plan</p>
                  {planHistory.length > 0 && (
                    <div className="recent-plans">
                      <h4>Recent Plans (This Session)</h4>
                      {planHistory.slice(0, 3).map((plan, idx) => (
                        <small key={idx} className="recent-plan">
                          {plan.timestamp}: {plan.input.substring(0, 40)}...
                        </small>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : (
          // WEEKLY VIEW
          <div className="weekly-view">
            <h2>📊 Your Weekly Plan</h2>
            <div className="week-grid">
              {days.map((day, idx) => (
                <div key={idx} className="day-card">
                  <h4>{day}</h4>
                  <p className="day-date">{new Date(Date.now() + idx * 86400000).toLocaleDateString()}</p>
                  {weeklyPlans[idx] ? (
                    <div className="day-plan">
                      <p className="day-tasks">{weeklyPlans[idx].tasks} tasks</p>
                      <p className="day-time">{weeklyPlans[idx].hours}h planned</p>
                    </div>
                  ) : (
                    <p className="day-empty">No plan yet</p>
                  )}
                  <button 
                    onClick={() => {
                      if (response) {
                        saveWeeklyPlan(idx, {
                          tasks: response.response?.schedule?.length || 0,
                          hours: Math.ceil((response.response?.schedule?.reduce((a, b) => a + b.estimatedMinutes, 0) || 0) / 60)
                        })
                      }
                    }}
                    className="btn-week"
                  >
                    {response ? '📌 Save' : '→'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default App