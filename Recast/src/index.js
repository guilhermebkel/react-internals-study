import Recast, { useState } from "./lib/Recast"

/** @jsx Recast.createElement */
const Counter = () => {
	const [state, setState] = useState(1)

	return (
		<button onClick={() => setState(c => c + 1)}>
			<h1>
				Count: {state}
			</h1>
		</button>
	)
}

const element = <Counter />

const container = document.getElementById("root")

Recast.render(element, container)