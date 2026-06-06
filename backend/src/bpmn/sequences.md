React Client          Node.js Backend              Camunda Engine              Database
     │                      │                            │                         │
     │  POST /requisitions  │                            │                         │
     │─────────────────────→│                            │                         │
     │                      │                            │                         │
     │                      │  Start Process             │                         │
     │                      │───────────────────────────→│                         │
     │                      │                            │                         │
     │                      │  Process Instance Created  │                         │
     │                      │←───────────────────────────│                         │
     │                      │                            │                         │
     │  { processInstanceId }│                            │                         │
     │←─────────────────────│                            │                         │
     │                      │                            │                         │
     │                      │                            │  ┌─────────────────────┐│
     │                      │                            │  │ BPMN Engine avance  ││
     │                      │                            │  │ jusqu'au serviceTask││
     │                      │                            │  └─────────────────────┘│
     │                      │                            │                         │
     │                      │  ←─── POLLING ───→         │                         │
     │                      │  GET /external-task        │                         │
     │                      │───────────────────────────→│                         │
     │                      │                            │                         │
     │                      │  [Tâche: check_budget]     │                         │
     │                      │←───────────────────────────│                         │
     │                      │                            │                         │
     │                      │  Traitement métier         │                         │
     │                      │  Query budget              │                         │
     │                      │─────────────────────────────────────────────────────→│
     │                      │                            │                         │
     │                      │  Budget disponible ?       │                         │
     │                      │←─────────────────────────────────────────────────────│
     │                      │                            │                         │
     │                      │  Complete Task             │                         │
     │                      │  POST /complete            │                         │
     │                      │───────────────────────────→│                         │
     │                      │                            │                         │
     │                      │                            │  ┌─────────────────────┐│
     │                      │                            │  │ BPMN Engine avance  ││
     │                      │                            │  │ vers prochaine étape││
     │                      │                            │  └─────────────────────┘│
     │                      │                            │                         │