import type { ProjectComponent, ProjectIndex } from '$lib/domain/project';

export interface PowerEdge {
	from: string;
	to: string;
	component: string;
	confidence: 'high' | 'medium';
}

export interface PowerRail {
	name: string;
	components: string[];
	sourceComponents: string[];
}

export interface PowerGraph {
	rails: PowerRail[];
	edges: PowerEdge[];
}

const powerName = /(^|[_+-])(VCC|VDD|VDDA|VDDD|VBAT|VIN|VOUT|PVDD|PVIN|AVDD|DVDD|IOVDD|[0-9]+V[0-9]*)([_+-]|$)/i;
const groundName = /(^|[_+-])(GND|AGND|DGND|PGND)([_+-]|$)/i;
const converterText = /(regulator|converter|buck|boost|ldo|pmic|power management|dc.?dc)/i;
const inputPin = /^(VIN|PVIN|AVIN|VBAT|VCC|VDDIN|SUPPLY)/i;
const outputPin = /^(VOUT|OUT|SW|LX|PH|PVDD|AVDD|DVDD)/i;

function componentText(component: ProjectComponent) {
	return [
		component.designator,
		component.schematic?.value,
		component.schematic?.comment,
		component.schematic?.libRef,
		component.bom?.comment,
		component.bom?.description,
		...Object.values(component.schematic?.parameters ?? {})
	]
		.filter(Boolean)
		.join(' ');
}

export function buildPowerGraph(index: ProjectIndex): PowerGraph {
	const rails = new Map<string, { name: string; components: Set<string>; sources: Set<string> }>();
	const edges = new Map<string, PowerEdge>();

	const rail = (name: string) => {
		const key = name.toUpperCase();
		let current = rails.get(key);
		if (!current) {
			current = { name, components: new Set(), sources: new Set() };
			rails.set(key, current);
		}
		return current;
	};

	for (const component of index.components) {
		const pinsByNumber = new Map(
			(component.schematic?.pins ?? []).map((pin) => [pin.num.trim().toUpperCase(), pin])
		);
		const candidates = component.pinConnections
			.map((connection) => ({
				...connection,
				pin: pinsByNumber.get(connection.pinNumber.trim().toUpperCase())
			}))
			.filter(
				(connection) =>
					!groundName.test(connection.net) &&
					(powerName.test(connection.net) ||
						powerName.test(connection.pinName) ||
						powerName.test(connection.pin?.name ?? ''))
			);

		for (const connection of candidates) {
			const current = rail(connection.net);
			current.components.add(component.designator);
			if (outputPin.test(connection.pinName || connection.pin?.name || '')) {
				current.sources.add(component.designator);
			}
		}

		if (!converterText.test(componentText(component))) continue;
		const inputs = candidates.filter((connection) =>
			inputPin.test(connection.pinName || connection.pin?.name || '')
		);
		const outputs = candidates.filter((connection) =>
			outputPin.test(connection.pinName || connection.pin?.name || '')
		);
		for (const input of inputs) {
			for (const output of outputs) {
				if (input.net.toUpperCase() === output.net.toUpperCase()) continue;
				const edge: PowerEdge = {
					from: input.net,
					to: output.net,
					component: component.designator,
					confidence: 'high'
				};
				edges.set(`${edge.from}|${edge.to}|${edge.component}`.toUpperCase(), edge);
				rail(output.net).sources.add(component.designator);
			}
		}
	}

	return {
		rails: Array.from(rails.values())
			.map((item) => ({
				name: item.name,
				components: Array.from(item.components),
				sourceComponents: Array.from(item.sources)
			}))
			.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
		edges: Array.from(edges.values())
	};
}
