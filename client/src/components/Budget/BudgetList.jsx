// src/components/Budget/BudgetList.jsx
// Registre budgétaire : tableau antd (pagination et tri côté serveur, GET /budget?page=), filtres (recherche, source de
// financement, projet, statut), totaux du filtre, export Excel réimportable et import Excel / CSV (MANAGE_BUDGET).
// Auditeur (AUDIT_ACCESS) : consultation et export seulement.
import React, { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Table } from 'antd';
import { Plus, Edit, Trash2, Eye, DollarSign, TrendingUp, TrendingDown, Search, Download, Upload, AlertTriangle, Wallet } from 'lucide-react';
import toast from 'react-hot-toast';
import { budgetService } from '../../services/budgetService';
import { projectService } from '../../services/projectService';
import { useCurrency } from '../../contexts/EnterpriseContext';
import { usePermissions } from '../../hooks/usePermissions';
import { downloadBlob } from '../../utils/supplierDocs';
import Modal from '../Common/Modal';
import SearchSelect from '../Common/SearchSelect';
import BudgetForm from './BudgetForm';
import BudgetDetail from './BudgetDetail';
import ImportBudgetModal from './ImportBudgetModal';
import { t, getLocale } from '../../i18n';

const NO_PROJECT = '__none__';
const SORT_KEYS = { entity_code: 'code', project_code: 'project', allocated_amount: 'allocated', utilized_amount: 'utilized', remaining_amount: 'remaining', rate: 'rate' };
const rateOf = (b) => (Number(b.allocated_amount) > 0 ? (Number(b.utilized_amount) / Number(b.allocated_amount)) * 100 : 0);
const fmtRate = (v) => `${Number(v).toLocaleString(getLocale(), { maximumFractionDigits: 1 })} %`;

export default function BudgetList() {
  const { formatAmount } = useCurrency();
  const queryClient = useQueryClient();
  const canManage = usePermissions().hasPermission('MANAGE_BUDGET');

  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState({ search: '', fundingSource: 'all', project: '', status: 'all' });
  const [pagination, setPagination] = useState({ page: 1, limit: 20 });
  const [sort, setSort] = useState({ sort: 'code', order: 'asc' });
  const [showModal, setShowModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [selectedBudget, setSelectedBudget] = useState(null);
  const [exporting, setExporting] = useState(false);

  // Recherche : appliquée 300 ms après la dernière frappe
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters(f => (f.search === searchInput.trim() ? f : { ...f, search: searchInput.trim() }));
      setPagination(p => ({ ...p, page: 1 }));
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const setFilter = (key, value) => {
    setFilters(f => ({ ...f, [key]: value }));
    setPagination(p => ({ ...p, page: 1 }));
  };

  const queryParams = {
    ...(filters.search && { search: filters.search }),
    ...(filters.fundingSource !== 'all' && { fundingSource: filters.fundingSource }),
    ...(filters.project === NO_PROJECT ? { withoutProject: 1 } : filters.project ? { projectId: filters.project } : {}),
    ...(filters.status !== 'all' && { status: filters.status }),
  };

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['budgets', queryParams, pagination, sort],
    queryFn: () => budgetService.getRegister({ ...queryParams, ...sort, page: pagination.page, limit: pagination.limit }),
    keepPreviousData: true,
  });
  const { data: summaryData } = useQuery({ queryKey: ['budget-summary'], queryFn: () => budgetService.getSummary() });
  const { data: sourcesData } = useQuery({ queryKey: ['budget-funding-sources'], queryFn: () => budgetService.getFundingSources() });
  const { data: projectsData } = useQuery({ queryKey: ['projects-for-budget-filter'], queryFn: () => projectService.getAll() });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['budgets'] });
    queryClient.invalidateQueries({ queryKey: ['budget-summary'] });
    queryClient.invalidateQueries({ queryKey: ['budget-funding-sources'] });
  };

  const deleteMutation = useMutation({
    mutationFn: (id) => budgetService.delete(id),
    onSuccess: () => { refresh(); toast.success(t('budget.deleted')); },
  });

  const budgets = data?.data || [];
  const totals = data?.totals;
  const summary = summaryData?.data?.summary;
  const sources = sourcesData?.data || [];
  const projects = projectsData?.data || [];

  const exportExcel = async () => {
    setExporting(true);
    try {
      downloadBlob(await budgetService.exportRegister({ ...queryParams, ...sort }), `${t('budget.register.exportFile')}_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch {
      toast.error(t('budget.register.exportFailed'));
    } finally {
      setExporting(false);
    }
  };

  const sortOrder = (key) => (sort.sort === SORT_KEYS[key] ? (sort.order === 'desc' ? 'descend' : 'ascend') : null);

  const columns = [
    {
      title: t('budget.entityCode'), dataIndex: 'entity_code', key: 'entity_code', fixed: 'left', sorter: true, sortOrder: sortOrder('entity_code'),
      render: (v, b) => (
        <div data-testid="budget-row-code">
          <div className="font-mono text-sm font-semibold text-gray-900">{v}</div>
          {b.description && <div className="text-xs text-gray-500 max-w-[260px] truncate" title={b.description}>{b.description}</div>}
        </div>
      ),
    },
    {
      title: t('budget.project'), dataIndex: 'project_code', key: 'project_code', sorter: true, sortOrder: sortOrder('project_code'),
      render: (v, b) => (v ? <div><div className="font-medium text-gray-800">{v}</div><div className="text-xs text-gray-500 max-w-[200px] truncate" title={b.project_name}>{b.project_name}</div></div>
        : <span className="text-gray-400">—</span>),
    },
    { title: t('budget.loc'), dataIndex: 'loc', key: 'loc', render: (v) => v || <span className="text-gray-400">—</span> },
    {
      title: t('budget.source'), dataIndex: 'funding_source', key: 'funding_source',
      render: (v) => (v ? <span className="px-2 py-0.5 text-xs rounded-full bg-blue-50 text-blue-700 whitespace-nowrap">{v}</span> : <span className="text-gray-400">—</span>),
    },
    { title: t('budget.subProject'), dataIndex: 'sub_project', key: 'sub_project', render: (v) => v || <span className="text-gray-400">—</span> },
    { title: t('budget.functionCode'), dataIndex: 'function_code', key: 'function_code', render: (v) => v || <span className="text-gray-400">—</span> },
    { title: t('budget.activityCode'), dataIndex: 'activity_code', key: 'activity_code', render: (v) => v || <span className="text-gray-400">—</span> },
    {
      title: t('budget.allocated'), dataIndex: 'allocated_amount', key: 'allocated_amount', align: 'right', sorter: true, sortOrder: sortOrder('allocated_amount'),
      render: (v) => <span className="font-medium tabular-nums whitespace-nowrap">{formatAmount(v || 0)}</span>,
    },
    {
      title: t('budget.utilized'), dataIndex: 'utilized_amount', key: 'utilized_amount', align: 'right', sorter: true, sortOrder: sortOrder('utilized_amount'),
      render: (v) => <span className="tabular-nums whitespace-nowrap">{formatAmount(v || 0)}</span>,
    },
    {
      title: t('budget.remaining'), dataIndex: 'remaining_amount', key: 'remaining_amount', align: 'right', sorter: true, sortOrder: sortOrder('remaining_amount'),
      render: (v) => <span className={`tabular-nums whitespace-nowrap ${Number(v) < 0 ? 'text-red-600 font-medium' : ''}`}>{formatAmount(v || 0)}</span>,
    },
    {
      title: t('budget.utilization'), key: 'rate', sorter: true, sortOrder: sortOrder('rate'), width: 170,
      render: (_, b) => {
        const rate = rateOf(b);
        const over = rate > 100;
        return (
          <div className="flex items-center gap-2" title={t('budget.register.rateTooltip', { rate: fmtRate(rate) })}>
            <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden min-w-[60px]" aria-hidden="true">
              <div className={`h-full rounded-full ${over ? 'bg-red-500' : 'bg-blue-600'}`} style={{ width: `${Math.min(rate, 100)}%` }} />
            </div>
            <span className={`text-xs tabular-nums whitespace-nowrap inline-flex items-center gap-0.5 ${over ? 'text-red-600 font-medium' : 'text-gray-700'}`}>
              {over && <AlertTriangle size={11} aria-label={t('budget.register.overBudget')} />}{fmtRate(rate)}
            </span>
          </div>
        );
      },
    },
    {
      title: t('budget.register.status'), dataIndex: 'is_active', key: 'is_active',
      render: (v) => (v
        ? <span className="px-2 py-0.5 text-xs rounded-full bg-green-50 text-green-700">{t('budget.register.active')}</span>
        : <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-600">{t('budget.register.inactive')}</span>),
    },
    {
      title: t('common.actions'), key: 'actions', fixed: 'right', align: 'right',
      render: (_, budget) => (
        <div className="flex justify-end gap-2">
          <button onClick={() => { setSelectedBudget(budget); setShowDetailModal(true); }} className="text-blue-600 hover:text-blue-800" title={t('budget.viewDetails')}>
            <Eye size={18} />
          </button>
          {canManage && (
            <>
              <button onClick={() => { setSelectedBudget(budget); setShowModal(true); }} className="text-green-600 hover:text-green-800" title={t('common.edit')}>
                <Edit size={18} />
              </button>
              <button onClick={() => { if (confirm(t('budget.confirmDelete'))) deleteMutation.mutate(budget.id); }}
                className="text-red-600 hover:text-red-800" title={t('common.delete')}>
                <Trash2 size={18} />
              </button>
            </>
          )}
        </div>
      ),
    },
  ];

  const SummaryCard = ({ label, value, icon: Icon, color }) => (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">{label}</p>
          <p className={`text-2xl font-bold ${color}`}>{value}</p>
        </div>
        <Icon size={32} className="text-gray-300" />
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">{t('budget.title')}</h1>
          <p className="text-gray-500 mt-1">{t('budget.subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={exportExcel} disabled={exporting} data-testid="budget-export"
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 bg-white text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50">
            <Download size={18} /> {exporting ? t('budget.register.exporting') : t('budget.register.export')}
          </button>
          {canManage && (
            <>
              <button onClick={() => setShowImport(true)} data-testid="budget-import"
                className="flex items-center gap-2 px-4 py-2 border border-blue-600 text-blue-700 rounded-lg hover:bg-blue-50">
                <Upload size={18} /> {t('budget.register.import')}
              </button>
              <button onClick={() => { setSelectedBudget(null); setShowModal(true); }}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                <Plus size={18} /> {t('budget.new')}
              </button>
            </>
          )}
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard label={t('budget.totalBudgets')} value={summary.total_budgets} icon={Wallet} color="text-gray-800" />
          <SummaryCard label={t('budget.totalAllocated')} value={formatAmount(summary.total_allocated || 0)} icon={TrendingUp} color="text-gray-900" />
          <SummaryCard label={t('budget.totalUtilized')} value={formatAmount(summary.total_utilized || 0)} icon={TrendingDown} color="text-gray-900" />
          <SummaryCard label={t('budget.totalRemaining')} value={formatAmount(summary.total_remaining || 0)} icon={DollarSign} color="text-gray-900" />
        </div>
      )}

      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-[220px] relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input type="text" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} data-testid="budget-search"
              placeholder={t('budget.register.searchPlaceholder')}
              className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500" />
          </div>
          <SearchSelect value={filters.fundingSource} onChange={(e) => setFilter('fundingSource', e.target.value)} data-testid="budget-filter-source"
            aria-label={t('budget.source')} className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500">
            <option value="all">{t('budget.allSources')}</option>
            {sources.map(s => <option key={s} value={s}>{s}</option>)}
          </SearchSelect>
          <SearchSelect value={filters.project} onChange={(e) => setFilter('project', e.target.value)} data-testid="budget-filter-project"
            aria-label={t('budget.project')} className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 max-w-[280px]">
            <option value="">{t('budget.register.allProjects')}</option>
            <option value={NO_PROJECT}>{t('budget.register.withoutProject')}</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.code ? `${p.code} — ` : ''}{p.name}</option>)}
          </SearchSelect>
          <SearchSelect value={filters.status} onChange={(e) => setFilter('status', e.target.value)} data-testid="budget-filter-status"
            aria-label={t('budget.register.status')} className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500">
            <option value="all">{t('budget.register.allStatuses')}</option>
            <option value="active">{t('budget.register.activeLines')}</option>
            <option value="inactive">{t('budget.register.inactiveLines')}</option>
          </SearchSelect>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden" data-testid="budget-table">
        <Table
          rowKey="id"
          size="middle"
          columns={columns}
          dataSource={budgets}
          loading={isLoading || (isFetching && !budgets.length)}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: <div className="py-8 text-center text-gray-500">{t('budget.none')}</div> }}
          onChange={(_, __, sorter) => {
            const key = SORT_KEYS[sorter?.columnKey];
            setSort(key && sorter.order ? { sort: key, order: sorter.order === 'descend' ? 'desc' : 'asc' } : { sort: 'code', order: 'asc' });
          }}
          pagination={{
            current: pagination.page,
            pageSize: pagination.limit,
            total: data?.pagination?.total || 0,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50, 100],
            showTotal: (total, [from, to]) => t('budget.register.showing', { from, to, total }),
            onChange: (page, limit) => setPagination(prev => ({ page: limit !== prev.limit ? 1 : page, limit })),
          }}
          summary={() => (totals && budgets.length ? (
            <Table.Summary fixed>
              <Table.Summary.Row className="bg-gray-50 font-semibold">
                <Table.Summary.Cell index={0} colSpan={6}>
                  <span data-testid="budget-totals">{t('budget.register.totals', { count: data?.pagination?.total || 0 })}</span>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={6} align="right"><span className="tabular-nums whitespace-nowrap">{formatAmount(totals.allocated)}</span></Table.Summary.Cell>
                <Table.Summary.Cell index={7} align="right"><span className="tabular-nums whitespace-nowrap">{formatAmount(totals.utilized)}</span></Table.Summary.Cell>
                <Table.Summary.Cell index={8} align="right"><span className="tabular-nums whitespace-nowrap">{formatAmount(totals.remaining)}</span></Table.Summary.Cell>
                <Table.Summary.Cell index={9}>
                  <span className="text-xs tabular-nums">{fmtRate(totals.allocated > 0 ? (totals.utilized / totals.allocated) * 100 : 0)}</span>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={10} colSpan={2} />
              </Table.Summary.Row>
            </Table.Summary>
          ) : null)}
        />
      </div>

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={selectedBudget ? t('budget.edit') : t('budget.new')} size="lg" showFooter={false}>
        <BudgetForm budget={selectedBudget} onClose={() => { setShowModal(false); refresh(); }} />
      </Modal>

      <Modal isOpen={showDetailModal} onClose={() => setShowDetailModal(false)} title={t('budget.detailTitle', { code: selectedBudget?.entity_code })} size="xl" showFooter={false}>
        <BudgetDetail budget={selectedBudget} onClose={() => setShowDetailModal(false)} />
      </Modal>

      {canManage && <ImportBudgetModal isOpen={showImport} onClose={() => setShowImport(false)} onImported={refresh} />}
    </div>
  );
}
