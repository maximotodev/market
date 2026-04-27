import type { ProductFormTab } from '@/lib/stores/product'
import type { ProductDraftValidation } from '@/lib/workflow/productDraftValidation'
import type { ProductWorkflowResolution } from '@/lib/workflow/productWorkflowResolver'

export type ProductAuthoringStage = 'basics' | 'pricing_inventory' | 'media' | 'delivery' | 'publish'

export const PRODUCT_AUTHORING_STAGES: ProductAuthoringStage[] = ['basics', 'pricing_inventory', 'media', 'delivery', 'publish']

export const PRODUCT_AUTHORING_STAGE_LABELS: Record<ProductAuthoringStage, string> = {
	basics: 'Basics',
	pricing_inventory: 'Pricing & Inventory',
	media: 'Media',
	delivery: 'Delivery',
	publish: 'Publish',
}

export const PRODUCT_AUTHORING_STAGE_TABS: Record<ProductAuthoringStage, ProductFormTab[]> = {
	basics: ['name', 'category'],
	pricing_inventory: ['detail', 'spec'],
	media: ['images'],
	delivery: ['shipping'],
	// Publish is a canonical workflow stage, not a legacy tab alias.
	publish: [],
}

export type ProductAuthoringStageState = {
	stage: ProductAuthoringStage
	label: string
	tabs: ProductFormTab[]
	primaryTab: ProductFormTab | null
	isComplete: boolean
	isSelected: boolean
	isFirstIncomplete: boolean
	issues: string[]
}

export type ProductAuthoringStageResolution = {
	stages: ProductAuthoringStageState[]
	selectedStage: ProductAuthoringStage
	firstIncompleteStage: ProductAuthoringStage | null
	canPublish: boolean
	publishIssues: string[]
	validation: ProductDraftValidation
}

export const PRODUCT_AUTHORING_V4V_SETUP_ISSUE = 'Value for Value (V4V) settings must be configured before publishing your first product'
export const PRODUCT_AUTHORING_BOOTSTRAP_ISSUE = 'Seller readiness is still loading'

export function isProductAuthoringStage(stage: string): stage is ProductAuthoringStage {
	return PRODUCT_AUTHORING_STAGES.includes(stage as ProductAuthoringStage)
}

export function getProductAuthoringStageForTab(tab: ProductFormTab): ProductAuthoringStage {
	if (tab === 'detail' || tab === 'spec') return 'pricing_inventory'
	if (tab === 'images') return 'media'
	if (tab === 'shipping') return 'delivery'

	return 'basics'
}

export function getProductAuthoringTabsForStage(stage: ProductAuthoringStage): ProductFormTab[] {
	return PRODUCT_AUTHORING_STAGE_TABS[stage]
}

export function getPrimaryProductAuthoringTabForStage(stage: ProductAuthoringStage): ProductFormTab | null {
	return PRODUCT_AUTHORING_STAGE_TABS[stage][0] ?? null
}

export function getNextProductAuthoringStage(stage: ProductAuthoringStage): ProductAuthoringStage | null {
	const index = PRODUCT_AUTHORING_STAGES.indexOf(stage)
	return PRODUCT_AUTHORING_STAGES[index + 1] ?? null
}

export function getPreviousProductAuthoringStage(stage: ProductAuthoringStage): ProductAuthoringStage | null {
	const index = PRODUCT_AUTHORING_STAGES.indexOf(stage)
	return index > 0 ? PRODUCT_AUTHORING_STAGES[index - 1] : null
}

export function resolveProductAuthoringStages({
	selectedStage,
	validation,
	workflow,
}: {
	selectedStage: ProductAuthoringStage
	validation: ProductDraftValidation
	workflow: ProductWorkflowResolution
}): ProductAuthoringStageResolution {
	const stageIssues: Record<ProductAuthoringStage, string[]> = {
		basics: getProductAuthoringTabsForStage('basics').flatMap((tab) => validation.issuesByTab[tab] ?? []),
		pricing_inventory: getProductAuthoringTabsForStage('pricing_inventory').flatMap((tab) => validation.issuesByTab[tab] ?? []),
		media: getProductAuthoringTabsForStage('media').flatMap((tab) => validation.issuesByTab[tab] ?? []),
		delivery: getProductAuthoringTabsForStage('delivery').flatMap((tab) => validation.issuesByTab[tab] ?? []),
		publish: [],
	}

	const publishIssues = [...validation.issues]
	if (!workflow.isBootstrapReady) publishIssues.push(PRODUCT_AUTHORING_BOOTSTRAP_ISSUE)
	if (workflow.requiresV4VSetup) publishIssues.push(PRODUCT_AUTHORING_V4V_SETUP_ISSUE)

	const canPublish = validation.allRequiredFieldsValid && workflow.isBootstrapReady && !workflow.requiresV4VSetup
	stageIssues.publish = canPublish ? [] : publishIssues

	const firstIncompleteStage =
		PRODUCT_AUTHORING_STAGES.find((stage) => {
			if (stage === 'publish') return !canPublish
			return stageIssues[stage].length > 0
		}) ?? null

	return {
		stages: PRODUCT_AUTHORING_STAGES.map((stage) => ({
			stage,
			label: PRODUCT_AUTHORING_STAGE_LABELS[stage],
			tabs: PRODUCT_AUTHORING_STAGE_TABS[stage],
			primaryTab: getPrimaryProductAuthoringTabForStage(stage),
			isComplete: stage === 'publish' ? canPublish : stageIssues[stage].length === 0,
			isSelected: stage === selectedStage,
			isFirstIncomplete: stage === firstIncompleteStage,
			issues: stageIssues[stage],
		})),
		selectedStage,
		firstIncompleteStage,
		canPublish,
		publishIssues,
		validation,
	}
}
