const t = [{
  id: '3d7b9bbb-472c-4f8f-8761-8a73a7888bb1',
  eventType: 'TASK_COMPLETED',
  taskId: 'e8fb7c1b-b2c6-4d1b-a9ec-b513e3841fa2',
  processInstanceId: '62ac7429-9fcf-4153-a168-316f28e9d795',
  processKey: 'ProcurementProcess',
  executionId: 'aafeff13-203a-4351-804d-a6fac87a05f5',
  taskName: 'Manager Approval (N1)',
  assignee: 'admin@procurement.com',
  oldStatus: 'claimed',
  newStatus: 'completed',
  timestamp: '2026-07-01T09:44:08.6299057Z',
  variables: {
    next_element: 'Gateway_ApprovalDecision',
    user_vars: { approved: true, comment: 'approved N1' }
  }
}
{
  id: '3afeab15-8538-4416-b46e-199e70a8c813',
  eventType: 'TASK_CREATED',
  taskId: '138ee499-850e-4599-9115-34fd8ae2c586',
  processInstanceId: '62ac7429-9fcf-4153-a168-316f28e9d795',
  processKey: 'ProcurementProcess',
  executionId: 'aafeff13-203a-4351-804d-a6fac87a05f5',
  taskName: 'Determine Procurement Type',
  candidateGroup: 'procurement',
  newStatus: 'created',
  timestamp: '2026-07-01T09:44:08.6585846Z'
},
{
  id: 'f067d9f7-5d73-4394-8fe8-6b3d5a6ebc43',
  eventType: 'TASK_CLAIMED',
  taskId: '138ee499-850e-4599-9115-34fd8ae2c586',
  processInstanceId: '62ac7429-9fcf-4153-a168-316f28e9d795',
  processKey: 'ProcurementProcess',
  executionId: 'aafeff13-203a-4351-804d-a6fac87a05f5',
  taskName: 'Determine Procurement Type',
  assignee: 'admin@procurement.com',
  candidateGroup: 'procurement',
  oldStatus: 'created',
  newStatus: 'claimed',
  timestamp: '2026-07-01T09:45:49.0130308Z',
  variables: { assignee: 'admin@procurement.com' }
},
{
  id: '7bee5244-5a61-4f16-a8a9-5ad776de1a22',
  eventType: 'TASK_COMPLETED',
  taskId: '138ee499-850e-4599-9115-34fd8ae2c586',
  processInstanceId: '62ac7429-9fcf-4153-a168-316f28e9d795',
  processKey: 'ProcurementProcess',
  executionId: 'aafeff13-203a-4351-804d-a6fac87a05f5',
  taskName: 'Determine Procurement Type',
  assignee: 'admin@procurement.com',
  oldStatus: 'claimed',
  newStatus: 'completed',
  timestamp: '2026-07-01T09:46:15.7239077Z',
  variables: {
    next_element: 'Task_ClassifyProcurement',
    user_vars: { procurementMethod: 'DIRECT_PURCHASE' }
  }
},
{
  id: '495458f4-ad45-4d6d-b92c-6555e4331f9e',
  eventType: 'TASK_CREATED',
  taskId: '9008b3cd-62b5-4a51-af34-aedb5f69ffea',
  processInstanceId: '62ac7429-9fcf-4153-a168-316f28e9d795',
  processKey: 'ProcurementProcess',
  executionId: 'aafeff13-203a-4351-804d-a6fac87a05f5',
  taskName: 'Direct Purchase',
  candidateGroup: 'procurement',
  newStatus: 'created',
  timestamp: '2026-07-01T09:46:16.9003106Z'
}]

