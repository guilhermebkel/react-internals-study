import Recast from "./lib/Recast"

/** @jsx Recast.createElement */
const Counter = () => {
	const [state, setState] = Recast.useState(1)

	return (
		<h1 onClick={() => setState(c => c + 1)}>
			Count: {state}
		</h1>
	)
}

const element = <Counter />

const container = document.getElementById("root")

Recast.render(element, container)