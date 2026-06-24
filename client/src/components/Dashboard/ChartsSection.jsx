// src/pages/Dashboard/components/ChartsSection.jsx
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useCurrency } from '../../contexts/EnterpriseContext';
import { motion } from 'framer-motion';
import * as echarts from 'echarts';
import {
    BarChart3,
    PieChart,
    LineChart,
    Download,
    FileDown,
    RefreshCw,
} from 'lucide-react';

export default function ChartsSection({ chartData, period }) {
    const { formatAmount } = useCurrency();
    const [activeTab, setActiveTab] = useState('trend');

    // Refs pour les conteneurs de graphiques
    const chartRefs = {
        department: useRef(null),
        trend: useRef(null),
        status: useRef(null),
        methods: useRef(null),
        supplier: useRef(null),
        budget: useRef(null)
    };

    // Refs pour les instances de graphiques
    const chartInstances = useRef({});
    const isInitialized = useRef(false);

    // Tabs configuration
    const tabs = useMemo(() => [
        { id: 'department', label: 'Départements', icon: BarChart3, description: 'Montant par département' },
        { id: 'trend', label: 'Tendance', icon: LineChart, description: 'Évolution des réquisitions' },
        { id: 'status', label: 'Statuts', icon: PieChart, description: 'Distribution des statuts' },
        { id: 'methods', label: 'Méthodes', icon: PieChart, description: 'Méthodes d\'achat' },
        { id: 'supplier', label: 'Fournisseurs', icon: BarChart3, description: 'Top fournisseurs' },
        { id: 'budget', label: 'Budget', icon: BarChart3, description: 'Allocation budgétaire' }
    ], []);

    // Couleurs ECharts
    const colors = useMemo(() => ({
        primary: '#4F46E5',
        secondary: '#10B981',
        danger: '#EF4444',
        warning: '#F59E0B',
        purple: '#8B5CF6',
        pink: '#EC4899',
        cyan: '#06B6D4',
        orange: '#F97316',
        gray: '#9CA3AF',
    }), []);

    const colorPalette = useMemo(() => [
        colors.primary, colors.secondary, colors.warning,
        colors.purple, colors.pink, colors.cyan, colors.orange
    ], [colors]);

    const formatCurrency = useCallback((amount) => formatAmount(amount), [formatAmount]);

    // 1. Graphique de tendance (Ligne)
    const getTrendOption = useCallback(() => {
        const data = chartData?.monthlyTrend || [];
        if (data.length === 0) {
            return {
                title: {
                    text: 'Aucune donnée disponible',
                    left: 'center',
                    top: 'center',
                    textStyle: { color: '#9CA3AF', fontSize: 14 }
                }
            };
        }

        return {
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'cross' },
                backgroundColor: 'rgba(255, 255, 255, 0.9)',
                borderColor: '#E5E7EB',
                borderWidth: 1,
                textStyle: { color: '#1F2937' },
                formatter: function (params) {
                    let html = `<div style="font-weight: bold; margin-bottom: 8px;">${params[0].axisValue}</div>`;
                    params.forEach(p => {
                        html += `<div style="display: flex; align-items: center; gap: 8px; margin: 4px 0;">
              <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: ${p.color};"></span>
              <span>${p.seriesName}: </span>
              <span style="font-weight: bold;">${p.value}</span>
            </div>`;
                    });
                    return html;
                }
            },
            legend: {
                data: ['Réquisitions', 'Approuvées', 'Rejetées', 'En attente'],
                bottom: 0,
                icon: 'roundRect',
                itemWidth: 12,
                itemHeight: 12,
                textStyle: { fontSize: 12, color: '#6B7280' }
            },
            grid: {
                left: 50,
                right: 30,
                top: 30,
                bottom: 60
            },
            xAxis: {
                type: 'category',
                data: data.map(item => item.period),
                axisLine: { lineStyle: { color: '#E5E7EB' } },
                axisLabel: { color: '#6B7280', fontSize: 11 },
                axisTick: { show: false }
            },
            yAxis: {
                type: 'value',
                splitLine: { lineStyle: { color: '#F3F4F6', type: 'dashed' } },
                axisLabel: { color: '#6B7280', fontSize: 11 }
            },
            series: [
                {
                    name: 'Réquisitions',
                    type: 'line',
                    smooth: true,
                    symbol: 'circle',
                    symbolSize: 8,
                    lineStyle: { color: colors.primary, width: 3 },
                    areaStyle: {
                        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                            { offset: 0, color: 'rgba(79, 70, 229, 0.3)' },
                            { offset: 1, color: 'rgba(79, 70, 229, 0.05)' }
                        ])
                    },
                    data: data.map(item => item.requisitions),
                    emphasis: { focus: 'series', lineStyle: { width: 4 } }
                },
                {
                    name: 'Approuvées',
                    type: 'line',
                    smooth: true,
                    symbol: 'diamond',
                    symbolSize: 8,
                    lineStyle: { color: colors.secondary, width: 2 },
                    data: data.map(item => item.approved || 0),
                    emphasis: { focus: 'series' }
                },
                {
                    name: 'Rejetées',
                    type: 'line',
                    smooth: true,
                    symbol: 'triangle',
                    symbolSize: 8,
                    lineStyle: { color: colors.danger, width: 2 },
                    data: data.map(item => item.rejected || 0),
                    emphasis: { focus: 'series' }
                },
                {
                    name: 'En attente',
                    type: 'line',
                    smooth: true,
                    symbol: 'rect',
                    symbolSize: 8,
                    lineStyle: { color: colors.warning, width: 2 },
                    data: data.map(item => item.pending || 0),
                    emphasis: { focus: 'series' }
                }
            ],
            animationDuration: 800,
            animationEasing: 'cubicOut'
        };
    }, [chartData, colors]);

    // 2. Graphique de distribution des statuts (Donut)
    const getStatusOption = useCallback(() => {
        const data = chartData?.statusDistribution || [];
        if (data.length === 0) {
            return {
                title: {
                    text: 'Aucune donnée disponible',
                    left: 'center',
                    top: 'center',
                    textStyle: { color: '#9CA3AF', fontSize: 14 }
                }
            };
        }

        return {
            tooltip: {
                trigger: 'item',
                formatter: function (params) {
                    return `<div style="font-weight: bold; margin-bottom: 4px;">${params.name}</div>
            <div>Nombre: <strong>${params.value}</strong></div>
            <div>Pourcentage: <strong>${params.percent}%</strong></div>`;
                }
            },
            legend: {
                orient: 'vertical',
                right: '5%',
                top: 'center',
                itemWidth: 12,
                itemHeight: 12,
                textStyle: { fontSize: 12, color: '#6B7280' },
                formatter: function (name) {
                    const item = data.find(d => d.name === name);
                    return `${name} (${item?.value || 0})`;
                }
            },
            series: [
                {
                    type: 'pie',
                    radius: ['45%', '75%'],
                    avoidLabelOverlap: true,
                    padAngle: 2,
                    itemStyle: {
                        borderRadius: 6,
                        borderColor: '#fff',
                        borderWidth: 2
                    },
                    label: {
                        show: true,
                        formatter: '{d}%',
                        fontSize: 12,
                        fontWeight: 'bold',
                        color: '#6B7280'
                    },
                    labelLine: { length: 15, length2: 10 },
                    emphasis: {
                        scale: true,
                        scaleSize: 5,
                        label: { show: true, fontSize: 14, fontWeight: 'bold' }
                    },
                    data: data.map(item => ({
                        name: item.name,
                        value: item.value,
                        itemStyle: { color: item.color }
                    })),
                    animationType: 'scale',
                    animationDuration: 800,
                    animationEasing: 'cubicOut'
                }
            ]
        };
    }, [chartData]);

    // 3. Graphique des méthodes d'achat (Pie)
    const getMethodsOption = useCallback(() => {
        const data = chartData?.procurementMethods || [];
        if (data.length === 0) {
            return {
                title: {
                    text: 'Aucune donnée disponible',
                    left: 'center',
                    top: 'center',
                    textStyle: { color: '#9CA3AF', fontSize: 14 }
                }
            };
        }

        return {
            tooltip: {
                trigger: 'item',
                formatter: function (params) {
                    return `<div style="font-weight: bold; margin-bottom: 4px;">${params.name}</div>
            <div>Nombre: <strong>${params.value}</strong></div>
            <div>Montant: <strong>${formatCurrency(params.data.amount)}</strong></div>
            <div>Pourcentage: <strong>${params.percent}%</strong></div>`;
                }
            },
            legend: {
                orient: 'vertical',
                right: '5%',
                top: 'center',
                itemWidth: 12,
                itemHeight: 12,
                textStyle: { fontSize: 12, color: '#6B7280' }
            },
            series: [
                {
                    type: 'pie',
                    radius: ['40%', '70%'],
                    avoidLabelOverlap: false,
                    itemStyle: {
                        borderRadius: 8,
                        borderColor: '#fff',
                        borderWidth: 2
                    },
                    label: {
                        show: true,
                        formatter: '{b}\n{d}%',
                        fontSize: 11,
                        color: '#6B7280'
                    },
                    emphasis: { scale: true, scaleSize: 5 },
                    data: data.map(item => ({
                        name: item.name,
                        value: item.value,
                        amount: item.amount,
                        itemStyle: { color: item.color }
                    })),
                    animationType: 'scale',
                    animationDuration: 800
                }
            ]
        };
    }, [chartData, formatCurrency]);

    // 4. Graphique des départements (Barre)
    const getDepartmentOption = useCallback(() => {
        const data = chartData?.departmentData || [];
        if (data.length === 0) {
            return {
                title: {
                    text: 'Aucune donnée disponible',
                    left: 'center',
                    top: 'center',
                    textStyle: { color: '#9CA3AF', fontSize: 14 }
                }
            };
        }

        return {
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'shadow' },
                formatter: function (params) {
                    const p = params[0];
                    const item = data.find(d => d.department_name === p.name);
                    return `<div style="font-weight: bold; margin-bottom: 4px;">${p.name}</div>
            <div>Montant: <strong>${formatCurrency(p.value)}</strong></div>
            <div>Réquisitions: <strong>${item?.count || 0}</strong></div>
            <div>Approuvées: <strong>${item?.approved_count || 0}</strong></div>`;
                }
            },
            grid: { left: 60, right: 30, top: 20, bottom: 50 },
            xAxis: {
                type: 'category',
                data: data.map(item => item.department_name),
                axisLine: { lineStyle: { color: '#E5E7EB' } },
                axisLabel: {
                    color: '#6B7280',
                    fontSize: 11,
                    rotate: data.length > 5 ? 30 : 0
                },
                axisTick: { show: false }
            },
            yAxis: {
                type: 'value',
                splitLine: { lineStyle: { color: '#F3F4F6', type: 'dashed' } },
                axisLabel: {
                    color: '#6B7280',
                    fontSize: 11,
                    formatter: function (value) {
                        return value >= 1000000 ? (value / 1000000) + 'M' :
                            value >= 1000 ? (value / 1000) + 'k' :
                                value;
                    }
                }
            },
            series: [
                {
                    type: 'bar',
                    barWidth: '40%',
                    data: data.map((item, index) => ({
                        value: item.amount,
                        itemStyle: {
                            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                                { offset: 0, color: colorPalette[index % colorPalette.length] },
                                { offset: 1, color: colorPalette[index % colorPalette.length] + '80' }
                            ]),
                            borderRadius: [6, 6, 0, 0]
                        }
                    })),
                    label: {
                        show: data.length <= 8,
                        position: 'top',
                        formatter: function (params) {
                            return formatCurrency(params.value);
                        },
                        fontSize: 10,
                        color: '#6B7280'
                    },
                    emphasis: {
                        itemStyle: {
                            shadowBlur: 10,
                            shadowOffsetX: 0,
                            shadowColor: 'rgba(0, 0, 0, 0.2)'
                        }
                    }
                }
            ],
            animationDuration: 800,
            animationEasing: 'cubicOut'
        };
    }, [chartData, formatCurrency, colorPalette]);

    // 5. Graphique des fournisseurs (Barre horizontale)
    const getSupplierOption = useCallback(() => {
        const data = chartData?.topSuppliers || [];
        if (data.length === 0) {
            return {
                title: {
                    text: 'Aucune donnée disponible',
                    left: 'center',
                    top: 'center',
                    textStyle: { color: '#9CA3AF', fontSize: 14 }
                }
            };
        }

        return {
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'shadow' },
                formatter: function (params) {
                    const p = params[0];
                    const item = data.find(d => d.name === p.name);
                    return `<div style="font-weight: bold; margin-bottom: 4px;">${p.name}</div>
            <div>Montant: <strong>${formatCurrency(p.value)}</strong></div>
            <div>Commandes: <strong>${item?.orders || 0}</strong></div>
            <div>Note: <strong>${item?.rating?.toFixed(1) || 'N/A'}/5</strong></div>`;
                }
            },
            grid: { left: 120, right: 60, top: 20, bottom: 20 },
            xAxis: {
                type: 'value',
                splitLine: { lineStyle: { color: '#F3F4F6', type: 'dashed' } },
                axisLabel: {
                    color: '#6B7280',
                    fontSize: 11,
                    formatter: function (value) {
                        return value >= 1000000 ? (value / 1000000) + 'M' :
                            value >= 1000 ? (value / 1000) + 'k' :
                                value;
                    }
                }
            },
            yAxis: {
                type: 'category',
                data: data.map(item => item.name),
                axisLine: { show: false },
                axisTick: { show: false },
                axisLabel: { color: '#6B7280', fontSize: 12, fontWeight: '500' }
            },
            series: [
                {
                    type: 'bar',
                    barWidth: '50%',
                    data: data.map((item, index) => ({
                        value: item.amount,
                        itemStyle: {
                            color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
                                { offset: 0, color: colorPalette[(index + 3) % colorPalette.length] },
                                { offset: 1, color: colorPalette[(index + 3) % colorPalette.length] + '60' }
                            ]),
                            borderRadius: [0, 6, 6, 0]
                        }
                    })),
                    label: {
                        show: true,
                        position: 'right',
                        formatter: function (params) {
                            return formatCurrency(params.value);
                        },
                        fontSize: 11,
                        color: '#6B7280',
                        fontWeight: '500'
                    },
                    emphasis: {
                        itemStyle: {
                            shadowBlur: 10,
                            shadowOffsetX: 0,
                            shadowColor: 'rgba(0, 0, 0, 0.2)'
                        }
                    }
                }
            ],
            animationDuration: 800,
            animationEasing: 'cubicOut'
        };
    }, [chartData, formatCurrency, colorPalette]);

    // 6. Graphique budgétaire (Barre empilée)
    const getBudgetOption = useCallback(() => {
        const data = chartData?.budgetSummary?.byFundingSource || [];
        if (data.length === 0) {
            return {
                title: {
                    text: 'Aucune donnée disponible',
                    left: 'center',
                    top: 'center',
                    textStyle: { color: '#9CA3AF', fontSize: 14 }
                }
            };
        }

        return {
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'shadow' },
                formatter: function (params) {
                    const p = params[0];
                    const item = data.find(d => d.funding_source === p.name);
                    return `<div style="font-weight: bold; margin-bottom: 4px;">${p.name}</div>
            <div>Alloué: <strong>${formatCurrency(item?.allocated || 0)}</strong></div>
            <div>Utilisé: <strong>${formatCurrency(item?.utilized || 0)}</strong></div>
            <div>Restant: <strong>${formatCurrency(item?.remaining || 0)}</strong></div>`;
                }
            },
            legend: {
                data: ['Alloué', 'Utilisé', 'Restant'],
                bottom: 0,
                icon: 'roundRect',
                itemWidth: 12,
                itemHeight: 12,
                textStyle: { fontSize: 12, color: '#6B7280' }
            },
            grid: { left: 50, right: 30, top: 30, bottom: 60 },
            xAxis: {
                type: 'category',
                data: data.map(item => item.funding_source),
                axisLine: { lineStyle: { color: '#E5E7EB' } },
                axisLabel: {
                    color: '#6B7280',
                    fontSize: 11,
                    rotate: data.length > 4 ? 20 : 0
                },
                axisTick: { show: false }
            },
            yAxis: {
                type: 'value',
                splitLine: { lineStyle: { color: '#F3F4F6', type: 'dashed' } },
                axisLabel: {
                    color: '#6B7280',
                    fontSize: 11,
                    formatter: function (value) {
                        return value >= 1000000 ? (value / 1000000) + 'M' :
                            value >= 1000 ? (value / 1000) + 'k' :
                                value;
                    }
                }
            },
            series: [
                {
                    name: 'Alloué',
                    type: 'bar',
                    stack: 'total',
                    barWidth: '40%',
                    itemStyle: { color: colors.primary },
                    data: data.map(item => item.allocated)
                },
                {
                    name: 'Utilisé',
                    type: 'bar',
                    stack: 'total',
                    barWidth: '40%',
                    itemStyle: { color: colors.secondary },
                    data: data.map(item => item.utilized)
                },
                {
                    name: 'Restant',
                    type: 'bar',
                    stack: 'total',
                    barWidth: '40%',
                    itemStyle: { color: colors.gray, borderRadius: [4, 4, 0, 0] },
                    data: data.map(item => item.remaining)
                }
            ],
            animationDuration: 800,
            animationEasing: 'cubicOut'
        };
    }, [chartData, formatCurrency, colors]);

    // Obtenir l'option du graphique actif
    const getChartOption = useCallback((tabId) => {
        switch (tabId) {
            case 'department': return getDepartmentOption();
            case 'trend': return getTrendOption();
            case 'status': return getStatusOption();
            case 'methods': return getMethodsOption();
            case 'supplier': return getSupplierOption();
            case 'budget': return getBudgetOption();
            default: return {};
        }
    }, [
        getDepartmentOption,
        getTrendOption,
        getStatusOption,
        getMethodsOption,
        getSupplierOption,
        getBudgetOption
    ]);

    // Mettre à jour un graphique spécifique
    const updateChart = useCallback((tabId) => {
        const instance = chartInstances.current[tabId];
        if (!instance) return;

        const option = getChartOption(tabId);
        instance.setOption(option, true);
        instance.resize();
    }, [getChartOption]);

    // Initialiser UNIQUEMENT le graphique actif
    useEffect(() => {
        const tabId = activeTab;
        const container = chartRefs[tabId]?.current;

        if (!container) return;

        // Si le graphique existe déjà, le mettre à jour
        if (chartInstances.current[tabId]) {
            updateChart(tabId);
            return;
        }

        // Créer une nouvelle instance
        const instance = echarts.init(container);
        chartInstances.current[tabId] = instance;

        // Définir l'option
        const option = getChartOption(tabId);
        instance.setOption(option, true);
        instance.resize();

        // Nettoyer lors du changement d'onglet ou du démontage
        return () => {
            // Ne pas détruire l'instance, elle sera réutilisée
        };
    }, [activeTab, getChartOption, updateChart]);

    // Mettre à jour lorsque les données changent
    useEffect(() => {
        if (!chartData) return;

        // Mettre à jour tous les graphiques existants
        Object.keys(chartInstances.current).forEach(tabId => {
            const instance = chartInstances.current[tabId];
            if (instance) {
                const option = getChartOption(tabId);
                instance.setOption(option, true);
                instance.resize();
            }
        });
    }, [chartData, getChartOption]);

    // Gérer le redimensionnement
    useEffect(() => {
        const handleResize = () => {
            Object.values(chartInstances.current).forEach(chart => {
                if (chart) chart.resize();
            });
        };

        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    // Gérer le changement d'onglet
    const handleTabChange = useCallback((tabId) => {
        setActiveTab(tabId);
        // Forcer la mise à jour du graphique après le changement d'onglet
        setTimeout(() => {
            updateChart(tabId);
        }, 50);
    }, [updateChart]);

    // Recharger les graphiques
    const handleRefresh = useCallback(() => {
        if (chartData) {
            updateChart(activeTab);
        }
    }, [chartData, activeTab, updateChart]);

    // Gérer l'export
    const handleExport = useCallback(() => {
        const container = chartRefs[activeTab]?.current;
        if (container) {
            const chart = echarts.getInstanceByDom(container);
            if (chart) {
                const url = chart.getDataURL({
                    type: 'png',
                    pixelRatio: 2,
                    backgroundColor: '#fff'
                });

                const link = document.createElement('a');
                link.href = url;
                link.download = `dashboard-chart-${activeTab}-${new Date().toISOString().split('T')[0]}.png`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            }
        }
    }, [activeTab]);

    // Gérer le téléchargement des données
    const handleDownloadData = useCallback(() => {
        const data = chartData?.monthlyTrend || [];
        if (data.length === 0) return;

        const headers = ['Période', 'Réquisitions', 'Approuvées', 'Rejetées', 'En attente', 'Montant'];
        const rows = data.map(item => [
            item.period,
            item.requisitions,
            item.approved || 0,
            item.rejected || 0,
            item.pending || 0,
            item.amount || 0
        ]);

        const csvContent = [
            headers.join(','),
            ...rows.map(row => row.join(','))
        ].join('\n');

        const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `dashboard-data-${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
    }, [chartData]);

    if (!chartData) {
        return (
            <div className="flex items-center justify-center h-64 bg-white rounded-xl shadow-sm border border-gray-200">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
                    <p className="mt-4 text-gray-500">Chargement des données...</p>
                </div>
            </div>
        );
    }

    // Trouver l'onglet actif
    const activeTabConfig = tabs.find(tab => tab.id === activeTab);
    const ActiveIcon = activeTabConfig?.icon || BarChart3;

    return (
        <div className="space-y-4">
            {/* En-tête avec contrôles */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white rounded-xl shadow-sm border border-gray-200 p-4">
                <div className="flex items-center space-x-4">
                    <BarChart3 className="w-5 h-5 text-indigo-500" />
                    <h3 className="text-lg font-semibold text-gray-800">Analyse des données</h3>
                    <span className="text-sm text-gray-500">
                        {period === 'week' ? 'Semaine' : period === 'month' ? 'Mois' : 'Année'} en cours
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleRefresh}
                        className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                        title="Actualiser"
                    >
                        <RefreshCw className="w-4 h-4" />
                    </button>
                    <button
                        onClick={handleExport}
                        className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                        title="Exporter le graphique en PNG"
                    >
                        <Download className="w-4 h-4" />
                    </button>
                    <button
                        onClick={handleDownloadData}
                        className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                        title="Télécharger les données (CSV)"
                    >
                        <FileDown className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Onglets */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                {/* Navigation des onglets */}
                <div className="border-b border-gray-200">
                    <nav className="flex overflow-x-auto scrollbar-hide" aria-label="Tabs">
                        {tabs.map((tab) => {
                            const Icon = tab.icon;
                            const isActive = activeTab === tab.id;

                            return (
                                <button
                                    key={tab.id}
                                    onClick={() => handleTabChange(tab.id)}
                                    className={`
                    group relative flex items-center px-4 py-3 text-sm font-medium transition-all duration-200
                    ${isActive
                                            ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50'
                                            : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                                        }
                    whitespace-nowrap
                  `}
                                >
                                    <Icon className={`
                    w-4 h-4 mr-2 transition-colors
                    ${isActive ? 'text-indigo-600' : 'text-gray-400 group-hover:text-gray-600'}
                  `} />
                                    <span>{tab.label}</span>
                                </button>
                            );
                        })}
                    </nav>
                </div>

                {/* Contenu des onglets - Tous les graphiques sont rendus mais seul l'actif est visible */}
                <div className="p-4">
                    {/* Titre du graphique actif */}
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center">
                            <ActiveIcon className="w-5 h-5 text-indigo-500 mr-2" />
                            <h4 className="text-sm font-semibold text-gray-700">
                                {activeTabConfig?.description || activeTabConfig?.label}
                            </h4>
                        </div>
                        <span className="text-xs text-gray-400">
                            {activeTab === 'department' && `${chartData.departmentData?.length || 0} départements`}
                            {activeTab === 'trend' && (period === 'week' ? '7 jours' : period === 'month' ? '30 jours' : '12 mois')}
                            {activeTab === 'status' && `${chartData.statusDistribution?.length || 0} statuts`}
                            {activeTab === 'methods' && `${chartData.procurementMethods?.length || 0} méthodes`}
                            {activeTab === 'supplier' && `${chartData.topSuppliers?.length || 0} fournisseurs`}
                            {activeTab === 'budget' && `${chartData.budgetSummary?.byFundingSource?.length || 0} sources`}
                        </span>
                    </div>

                    {/* Tous les conteneurs sont rendus, mais un seul est visible */}
                    <div style={{ position: 'relative', height: '400px' }}>
                        {tabs.map((tab) => (
                            <div
                                key={tab.id}
                                ref={chartRefs[tab.id]}
                                style={{
                                    position: 'absolute',
                                    top: 0,
                                    left: 0,
                                    right: 0,
                                    bottom: 0,
                                    visibility: activeTab === tab.id ? 'visible' : 'hidden',
                                    opacity: activeTab === tab.id ? 1 : 0,
                                    transition: 'opacity 0.3s ease'
                                }}
                            />
                        ))}
                    </div>
                </div>
            </div>

            {/* Métriques de performance */}
            {chartData.performanceMetrics && (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
                        <p className="text-xs text-gray-500">Délai moyen</p>
                        <p className="text-lg font-bold text-gray-900">{chartData.performanceMetrics.averageProcessingTime || 0}h</p>
                    </div>
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
                        <p className="text-xs text-gray-500">Livraison à temps</p>
                        <p className="text-lg font-bold text-green-600">{chartData.performanceMetrics.onTimeDelivery || 0}%</p>
                    </div>
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
                        <p className="text-xs text-gray-500">Conformité budgétaire</p>
                        <p className="text-lg font-bold text-blue-600">{chartData.performanceMetrics.budgetCompliance || 0}%</p>
                    </div>
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
                        <p className="text-xs text-gray-500">Satisfaction fournisseurs</p>
                        <p className="text-lg font-bold text-purple-600">{chartData.performanceMetrics.supplierSatisfaction || 0}/5</p>
                    </div>
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
                        <p className="text-xs text-gray-500">Taux de réapprobation</p>
                        <p className="text-lg font-bold text-orange-600">{chartData.performanceMetrics.reapprovalRate || 0}%</p>
                    </div>
                </div>
            )}

            {/* Résumé budgétaire */}
            {chartData.budgetSummary?.summary && (
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
                    <h4 className="text-sm font-semibold text-gray-700 mb-3">Résumé budgétaire</h4>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                        <div>
                            <p className="text-xs text-gray-500">Total alloué</p>
                            <p className="text-lg font-bold text-gray-900">{formatCurrency(chartData.budgetSummary.summary.totalAllocated)}</p>
                        </div>
                        <div>
                            <p className="text-xs text-gray-500">Total utilisé</p>
                            <p className="text-lg font-bold text-blue-600">{formatCurrency(chartData.budgetSummary.summary.totalUtilized)}</p>
                        </div>
                        <div>
                            <p className="text-xs text-gray-500">Total restant</p>
                            <p className="text-lg font-bold text-green-600">{formatCurrency(chartData.budgetSummary.summary.totalRemaining)}</p>
                        </div>
                        <div>
                            <p className="text-xs text-gray-500">Taux d'utilisation</p>
                            <p className="text-lg font-bold text-purple-600">{chartData.budgetSummary.summary.utilizationRate?.toFixed(1) || 0}%</p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}