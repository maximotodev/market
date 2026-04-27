import { describe, expect, test } from 'bun:test'
import { DEFAULT_FORM_STATE, type ProductFormState } from '@/lib/stores/product'
import { validateProductDraft } from '@/lib/workflow/productDraftValidation'
import {
	getPrimaryProductAuthoringTabForStage,
	getNextProductAuthoringStage,
	getProductAuthoringStageForTab,
	getProductAuthoringTabsForStage,
	PRODUCT_AUTHORING_STAGES,
	resolveProductAuthoringStages,
} from '@/lib/workflow/productAuthoringStages'
import type { ProductWorkflowResolution } from '@/lib/workflow/productWorkflowResolver'

const READY_WORKFLOW: ProductWorkflowResolution = {
	mode: 'create',
	isBootstrapReady: true,
	initialTab: 'name',
	shouldStartAtShipping: false,
	requiresV4VSetup: false,
}

const makeState = (overrides: Partial<ProductFormState> = {}): ProductFormState => ({
	...DEFAULT_FORM_STATE,
	...overrides,
})

const validate = (state: ProductFormState, resolvedShippingRefs = new Set<string>(['seller:standard'])) =>
	validateProductDraft({
		state,
		resolvedShippingRefs,
		isShippingFetched: true,
	})

const validDraft = makeState({
	name: 'Valid product',
	description: 'Valid description',
	price: '1000',
	quantity: '1',
	images: [{ imageUrl: 'https://example.com/image.png', imageOrder: 0 }],
	shippings: [{ shippingRef: 'seller:standard', extraCost: '' }],
})

describe('product authoring stages', () => {
	test('stage order is deterministic', () => {
		expect(PRODUCT_AUTHORING_STAGES).toEqual(['basics', 'pricing_inventory', 'media', 'delivery', 'publish'])
	})

	test('missing media blocks at the Media stage', () => {
		const resolution = resolveProductAuthoringStages({
			selectedStage: 'media',
			validation: validate(makeState({ ...validDraft, images: [] })),
			workflow: READY_WORKFLOW,
		})

		expect(resolution.firstIncompleteStage).toBe('media')
		expect(resolution.canPublish).toBe(false)
	})

	test('missing delivery blocks at the Delivery stage', () => {
		const resolution = resolveProductAuthoringStages({
			selectedStage: 'delivery',
			validation: validate(makeState({ ...validDraft, shippings: [] })),
			workflow: READY_WORKFLOW,
		})

		expect(resolution.firstIncompleteStage).toBe('delivery')
		expect(resolution.canPublish).toBe(false)
	})

	test('valid draft with ready seller state reaches Publish', () => {
		const resolution = resolveProductAuthoringStages({
			selectedStage: 'publish',
			validation: validate(validDraft),
			workflow: READY_WORKFLOW,
		})

		expect(resolution.firstIncompleteStage).toBeNull()
		expect(resolution.selectedStage).toBe('publish')
		expect(resolution.canPublish).toBe(true)
	})

	test('never-configured V4V blocks at the Publish stage', () => {
		const resolution = resolveProductAuthoringStages({
			selectedStage: 'publish',
			validation: validate(validDraft),
			workflow: {
				...READY_WORKFLOW,
				requiresV4VSetup: true,
			},
		})

		expect(resolution.firstIncompleteStage).toBe('publish')
		expect(resolution.canPublish).toBe(false)
		expect(resolution.publishIssues).toContain('Value for Value (V4V) settings must be configured before publishing your first product')
	})

	test('draft blockers stay on their mapped stage before Publish blockers', () => {
		const resolution = resolveProductAuthoringStages({
			selectedStage: 'publish',
			validation: validate(makeState({ ...validDraft, images: [] })),
			workflow: {
				...READY_WORKFLOW,
				requiresV4VSetup: true,
			},
		})

		expect(resolution.firstIncompleteStage).toBe('media')
		expect(resolution.canPublish).toBe(false)
		expect(resolution.publishIssues).toContain('At least one image is required')
		expect(resolution.publishIssues).toContain('Value for Value (V4V) settings must be configured before publishing your first product')
	})

	test('unresolved seller readiness blocks at the Publish stage', () => {
		const resolution = resolveProductAuthoringStages({
			selectedStage: 'publish',
			validation: validate(validDraft),
			workflow: {
				...READY_WORKFLOW,
				isBootstrapReady: false,
			},
		})

		expect(resolution.firstIncompleteStage).toBe('publish')
		expect(resolution.canPublish).toBe(false)
		expect(resolution.publishIssues).toContain('Seller readiness is still loading')
	})

	test('delivery advances to a real Publish stage without requiring a publish tab', () => {
		const resolution = resolveProductAuthoringStages({
			selectedStage: 'publish',
			validation: validate(validDraft),
			workflow: READY_WORKFLOW,
		})

		expect(getNextProductAuthoringStage('delivery')).toBe('publish')
		expect(resolution.selectedStage).toBe('publish')
		expect(getProductAuthoringTabsForStage('publish')).toEqual([])
		expect(getPrimaryProductAuthoringTabForStage('publish')).toBeNull()
		expect(resolution.stages.find((stage) => stage.stage === 'publish')?.primaryTab).toBeNull()
	})

	test('shipping tab maps to Delivery, not Publish', () => {
		expect(getProductAuthoringStageForTab('shipping')).toBe('delivery')
	})
})
