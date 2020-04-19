import { isEvent, isGone, isNew, isProperty } from "../util/filters"

class Recast {
	static nextUnitOfWork = null
	static workInProgressRoot = null
	static workInProgressFiber = null
	static currentRoot = null
	static deletions = null
	static hookIndex = null

	static useState(initial) {
		const oldHook = Recast.workInProgressFiber.alternate && Recast.workInProgressFiber.alternate.hooks && Recast.workInProgressFiber.alternate.hooks[Recast.hookIndex]

		const hook = {
			state: oldHook ? oldHook.state : initial,
			queue: []
		}

		const actions = oldHook ? oldHook.queue : []
		
		actions.forEach(action => {
			hook.state = action(hook.state)
		})

		const setState = action => {
			hook.queue.push(action)

			Recast.workInProgressRoot = {
				dom: Recast.currentRoot.dom,
				props: Recast.currentRoot.props,
				alternate: Recast.currentRoot,
			}

			Recast.nextUnitOfWork = Recast.workInProgressRoot

			Recast.deletions = []
		}

		Recast.workInProgressFiber.hooks.push(hook)
		Recast.hookIndex++

		return [hook.state, setState]
	}

	static createTextElement(text) {
		return {
			type: "TEXT_ELEMENT",
			props: {
				nodeValue: text,
				children: [],
			},
		}
	}

	static createElement(type, props, ...children) {
		return {
			type,
			props: {
				...props,
				/**
				 * Since the non object children need to be rendered as text,
				 * we make a special object with them.
				 */
				children: children.map((child) =>
					typeof child === "object" ? child : Recast.createTextElement(child)
				),
			},
		}
	}

	/**
	 * Once we finishing the rendering process,
	 * we'll call this function to commit everything
	 * show all the rendered information on browser
	 */
	static commitRoot() {
		Recast.deletions.forEach(Recast.commitWork)
		Recast.commitWork(Recast.workInProgressRoot.child)
		Recast.currentRoot = Recast.workInProgressRoot
		Recast.workInProgressRoot = null
	}

	static commitDeletion(fiber, DOMParent) {
		if (fiber.dom) {
			DOMParent.removeChild(fiber.dom)
		} else {
			Recast.commitDeletion(fiber.child, DOMParent)
		}
	}

	static commitWork(fiber) {
		if (!fiber) {
			return
		}

		let domParentFiber = fiber.parent

		while (!domParentFiber.dom) {
			domParentFiber = domParentFiber.parent
		}

		const DOMParent = domParentFiber.dom

		if (fiber.effectTag === "PLACEMENT" && fiber.dom != null) {
			DOMParent.appendChild(fiber.dom)
		} else if (fiber.effectTag === "UPDATE" && fiber.dom != null) {
			Recast.updateDOM(fiber.dom, fiber.alternate.props, fiber.props)
		} else if (fiber.effectTag === "DELETION") {
			Recast.commitDeletion(fiber, DOMParent)
		}

		Recast.commitWork(fiber.child)
		Recast.commitWork(fiber.sibling)
	}

	static updateFunctionComponent(fiber) {
		Recast.workInProgressFiber = fiber
		Recast.hookIndex = 0
		Recast.workInProgressFiber.hooks = []

		const children = [fiber.type(fiber.props)]

		Recast.reconcileChildren(fiber, children)
	}

	static updateHostComponent(fiber) {
		if (!fiber.dom) {
			fiber.dom = Recast.createDOM(fiber)
		}

		Recast.reconcileChildren(fiber, fiber.props.children)
	}

	/**
	 * We use this function to make a work on the fiber tree of DOM Elements
	 * in order to render everything.
	 */
	static performUnitWork(fiber) {
		const isFunctionComponent = fiber.type instanceof Function
		
		if (isFunctionComponent) {
			Recast.updateFunctionComponent(fiber)
		} else {
			Recast.updateHostComponent(fiber)
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

	static reconcileChildren(workInProgressFiber, elements) {
		let index = 0
		let oldFiber = workInProgressFiber.alternate && workInProgressFiber.alternate.child
		let prevSibling = null

		while (index < elements.length || oldFiber != null) {
			const element = elements[index]
			let newFiber = null

			const sameType = oldFiber && element && element.type == oldFiber.type

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
				Recast.deletions.push(oldFiber)
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
	 * In order to improve performance and avoid blocking all content viewing
	 * if rendering a great amount of code, we'll add a work loop with
	 * help of "window.requestIdleCallback" that will perform the render
	 * everytime the browser is idle. By using that, we'll perform the
	 * rendering with help of concurrency.
	 */
	static workLoop(deadline) {
		let shouldYield = false

		while (Recast.nextUnitOfWork && !shouldYield) {
			Recast.nextUnitOfWork = Recast.performUnitWork(Recast.nextUnitOfWork)
			shouldYield = deadline.timeRemaining() < 1
		}

		if (!Recast.nextUnitOfWork && Recast.workInProgressRoot) {
			Recast.commitRoot()
		}

		window.requestIdleCallback(Recast.workLoop)
	}

	static render(element, container) {
		/**
		 * When the 'Recast' module is called we'll start rendering the element
		 * when 'nextUnitOfWork' variable gets a not null content. So when we add
		 * this info to this variable, we basically tell to browser to start rendering.
		 */
		Recast.workInProgressRoot = {
			dom: container,
			props: {
				children: [element],
			},
			alternate: Recast.currentRoot,
		}

		Recast.deletions = []

		Recast.nextUnitOfWork = Recast.workInProgressRoot
	}

	static createDOM(fiber) {
		/**
		 * Since the text elements are rendered other way by Virtual DOM.
		 */
		const dom = fiber.type === "TEXT_ELEMENT" ? document.createTextNode("") : document.createElement(fiber.type)

		Recast.updateDOM(dom, {}, fiber.props)

		return dom
	}

	static updateDOM(dom, prevProps, nextProps) {
		//Remove old or changed event listeners
		Object.keys(prevProps)
			.filter(isEvent)
			.filter((key) => !(key in nextProps) || isNew(prevProps, nextProps)(key))
			.forEach((name) => {
				const eventType = name.toLowerCase().substring(2)
				dom.removeEventListener(eventType, prevProps[name])
			})

		// Remove old properties
		Object.keys(prevProps)
			.filter(isProperty)
			.filter(isGone(prevProps, nextProps))
			.forEach((name) => {
				dom[name] = ""
			})

		// Set new or changed properties
		Object.keys(nextProps)
			.filter(isProperty)
			.filter(isNew(prevProps, nextProps))
			.forEach((name) => {
				dom[name] = nextProps[name]
			})

		// Add event listeners
		Object.keys(nextProps)
			.filter(isEvent)
			.filter(isNew(prevProps, nextProps))
			.forEach((name) => {
				const eventType = name.toLowerCase().substring(2)
				dom.addEventListener(eventType, nextProps[name])
			})
	}
}

window.requestIdleCallback(Recast.workLoop)

export default Recast
