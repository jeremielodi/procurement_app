// Intérim du chef de projet pendant son absence (migration 53)
import api from './api'

export const delegationService = {
  list: async (params = {}) => (await api.get('/delegations', { params, skipErrorToast: true })).data,
  candidates: async () => (await api.get('/delegations/candidates')).data,
  create: async (data) => (await api.post('/delegations', data, { skipErrorToast: true })).data,
  end: async (id) => (await api.post(`/delegations/${id}/end`, {}, { skipErrorToast: true })).data,
}
