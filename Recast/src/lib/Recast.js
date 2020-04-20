import { isEvent, isGone, isNew, isProperty } from "../util/filters"

let nextUnitOfWork = null
let workInProgressRoot = null
let workInProgressFiber = null
let currentRoot = null
let deletions = null
let hookIndex = null

export function useState(initial) {
	const oldHook =
		workInProgressFiber.alternate &&
		workInProgressFiber.alternate.hooks &&
		workInProgressFiber.alternate.hooks[hookIndex]

	const hook = {
		state: oldHook ? oldHook.state : initial,
		queue: [],
	}

	const actions = oldHook ? oldHook.queue : []

	actions.forEach((action) => {
		hook.state = action(hook.state)
	})

	const setState = (action) => {
		hook.queue.push(action)

		workInProgressRoot = {
			dom: currentRoot.dom,
			props: currentRoot.props,
			alternate: currentRoot,
		}

		nextUnitOfWork = workInProgressRoot

		deletions = []
	}

	workInProgressFiber.hooks.push(hook)
	hookIndex++

	return [hook.state, setState]
}

/**
 * Since we render text elements other way, we'll tag them with
 * 'TEXT_ELEMENT' type in order to help rendering it later.
 */
function createTextElement(text) {
	return {
		type: "TEXT_ELEMENT",
		props: {
			nodeValue: text,
			children: [],
		},
	}
}

function createElement(type, props, ...children) {
	return {
		type,
		props: {
			...props,
			/**
			 * Since the non object children need to be rendered as text
			 * element, we make a simple validation here.
			 */
			children: children.map((child) =>
				typeof child === "object" ? child : createTextElement(child)
			),
		},
	}
}

/**
 * Once we finishing the rendering process,
 * we'll call this function to commit everything and
 * show all the rendered information on browser
 */
function commitRoot() {
	deletions.forEach(commitWork)
	commitWork(workInProgressRoot.child)
	currentRoot = workInProgressRoot
	workInProgressRoot = null
}

/**
 * In case the fiber has already rendered a DOM, we'll remove it,
 * else we'll commit the deletion of his child (in order to make a
 * recursion to delete all elements of this fiber if needed)
 */
function commitDeletion(fiber, DOMParent) {
	if (fiber.dom) {
		DOMParent.removeChild(fiber.dom)
	} else {
		commitDeletion(fiber.child, DOMParent)
	}
}

/**
 * Here we'll commit some work to be done on the given fiber
 */
function commitWork(fiber) {
	if (!fiber) {
		return
	}

	let DOMParentFiber = fiber.parent

	/**
	 * In case the current fiber parent has no rendered DOM,
	 * we try to search for a rendered DOM on its parent.
	 */
	while (!DOMParentFiber.dom) {
		DOMParentFiber = DOMParentFiber.parent
	}

	const DOMParent = DOMParentFiber.dom

	/**
	 * In case the fiber is tagged to be replaced
	 */
	if (fiber.effectTag === "PLACEMENT" && fiber.dom != null) {
		DOMParent.appendChild(fiber.dom)

	/**
	 * In case the fiber is tagged to be updated (element does not change, expect for its props)
	 */
	} else if (fiber.effectTag === "UPDATE" && fiber.dom != null) {
		updateDOM(fiber.dom, fiber.alternate.props, fiber.props)

	/**
	 * In case the fiber is tagged to be deleted
	 */
	} else if (fiber.effectTag === "DELETION") {
		commitDeletion(fiber, DOMParent)
	}

	commitWork(fiber.child)
	commitWork(fiber.sibling)
}

/**
 * In case we're dealing with a function component, we give a special
 * treatment to its hooks and the way we properly get the children
 */
function updateFunctionComponent(fiber) {
	workInProgressFiber = fiber
	hookIndex = 0
	workInProgressFiber.hooks = []

	const children = [fiber.type(fiber.props)]

	reconcileChildren(fiber, children)
}

/**
 * In case we're dealing with a simple JSX (<div></div>)
 */
function updateHostComponent(fiber) {
	if (!fiber.dom) {
		fiber.dom = createDOM(fiber)
	}

	reconcileChildren(fiber, fiber.props.children)
}

/**
 * We use this function to make a work on the fiber tree of DOM Elements
 * in order to render everything.
 */
function performUnitWork(fiber) {
	const isFunctionComponent = fiber.type instanceof Function

	if (isFunctionComponent) {
		updateFunctionComponent(fiber)
	} else {
		updateHostComponent(fiber)
	}

	if (fiber.child) {
		return fiber.child
	}

	let nextFiber = fiber

	while (nextFiber) {
		if (nextFiber.sibling) {
			return nextFiber.sibling
		}
		nextFiber = nextFiber.parent
	}
}

function reconcileChildren(workInProgressFiber, elements) {
	let index = 0
	let oldFiber = workInProgressFiber.alternate && workInProgressFiber.alternate.child
	let prevSibling = null

	while (index < elements.length || oldFiber != null) {
		const element = elements[index]
		let newFiber = null

		const sameType = oldFiber && element && element.type === oldFiber.type

		if (sameType) {
			newFiber = {
				type: oldFiber.type,
				props: element.props,
				dom: oldFiber.dom,
				parent: workInProgressFiber,
				alternate: oldFiber,
				effectTag: "UPDATE",
			}
		}
		if (element && !sameType) {
			newFiber = {
				type: element.type,
				props: element.props,
				dom: null,
				parent: workInProgressFiber,
				alternate: null,
				effectTag: "PLACEMENT",
			}
		}
		if (oldFiber && !sameType) {
			oldFiber.effectTag = "DELETION"
			deletions.push(oldFiber)
		}

		if (oldFiber) {
			oldFiber = oldFiber.sibling
		}

		if (index === 0) {
			workInProgressFiber.child = newFiber
		} else {
			prevSibling.sibling = newFiber
		}

		prevSibling = newFiber
		index++
	}
}

/**
 * In order to improve performance and avoid blocking all content viewing (for a long time)
 * if rendering a great amount of code, we'll add a work loop with
 * help of "window.requestIdleCallback" that will perform the render
 * everytime the browser is idle. By using that, we'll perform the
 * rendering with help of concurrency.
 */
function workLoop(deadline) {
	let shouldYield = false

	while (nextUnitOfWork && !shouldYield) {
		nextUnitOfWork = performUnitWork(nextUnitOfWork)
		shouldYield = deadline.timeRemaining() < 1
	}

	if (!nextUnitOfWork && workInProgressRoot) {
		commitRoot()
	}

	window.requestIdleCallback(workLoop)
}

function render(element, container) {
	workInProgressRoot = {
		dom: container,
		props: {
			children: [element],
		},
		alternate: currentRoot,
	}

	deletions = []

	/**
	 * When the 'Recast' module is called we'll start rendering the element
	 * when 'nextUnitOfWork' variable gets a not null content. So when we add
	 * this info to this variable, we basically tell to browser to start rendering.
	 */
	nextUnitOfWork = workInProgressRoot
}

function createDOM(fiber) {
	/**
	 * Since the text elements are rendered other way by Virtual DOM, we make a simple statement
	 * to handle this different rendering.
	 */
	const dom =
		fiber.type === "TEXT_ELEMENT" ? document.createTextNode("") : document.createElement(fiber.type)

	updateDOM(dom, {}, fiber.props)

	return dom
}

function updateDOM(dom, prevProps, nextProps) {
	/**
	 * Remove old or changed event listeners
	 */
	Object.keys(prevProps)
		.filter(isEvent)
		.filter((key) => !(key in nextProps) || isNew(prevProps, nextProps)(key))
		.forEach((name) => {
			const eventType = name.toLowerCase().substring(2)
			dom.removeEventListener(eventType, prevProps[name])
		})

	/**
	 * Remove old properties
	 */
	Object.keys(prevProps)
		.filter(isProperty)
		.filter(isGone(prevProps, nextProps))
		.forEach((name) => {
			dom[name] = ""
		})

	/**
	 * Set new or changed properties
	 */
	Object.keys(nextProps)
		.filter(isProperty)
		.filter(isNew(prevProps, nextProps))
		.forEach((name) => {
			dom[name] = nextProps[name]
		})

	/**
	 * Add event listeners
	 */
	Object.keys(nextProps)
		.filter(isEvent)
		.filter(isNew(prevProps, nextProps))
		.forEach((name) => {
			const eventType = name.toLowerCase().substring(2)
			dom.addEventListener(eventType, nextProps[name])
		})
}

/**
 * Start the rendering queue once this package is called
 */
window.requestIdleCallback(workLoop)

const Recast = {
	createElement,
	render,
	useState,
}

export default Recast
