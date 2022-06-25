/**
 * Functions related to color interpolation
 */
import Color from "./color.js";
import {type, interpolate} from "./util.js";
import defaults from "./defaults.js";
import * as angles from "./angles.js";

/**
 * Return an intermediate color between two colors
 * Signatures: Color.mix(c1, c2, p, options)
 *             Color.mix(c1, c2, options)
 *             Color.mix(color)
 * @param {Color | string} c1 The first color
 * @param {Color | string} [c2] The second color
 * @param {number} [p=.5] A 0-1 percentage where 0 is c1 and 1 is c2
 * @param {Object} [o={}]
 * @return {Color}
 */
export function mix (c1, c2, p = .5, o = {}) {
	[c1, c2] = [Color.get(c1), Color.get(c2)];

	if (type(p) === "object") {
		[p, o] = [.5, p];
	}

	let {space, outputSpace} = o;

	let range = c1.range(c2, {space, outputSpace});
	return range(p);
}

/**
 *
 * @param {Color | string | Function} c1 The first color or a range
 * @param {Color | string} [c2] The second color if c1 is not a range
 * @param {Object} [options={}]
 * @return {Color[]}
 */
export function steps (c1, c2, options = {}) {
	let colorRange;

	if (isRange(c1)) {
		// Tweaking existing range
		[colorRange, options] = [c1, c2];
		[c1, c2] = colorRange.rangeArgs.colors;
	}

	let {
		maxDeltaE, deltaEMethod,
		steps = 2, maxSteps = 1000,
		...rangeOptions
	} = options;

	if (!colorRange) {
		[c1, c2] = [Color.get(c1), Color.get(c2)];
		colorRange = range(c1, c2, rangeOptions);
	}

	let totalDelta = c1.deltaE(c2);
	let actualSteps = maxDeltaE > 0? Math.max(steps, Math.ceil(totalDelta / maxDeltaE) + 1) : steps;
	let ret = [];

	if (maxSteps !== undefined) {
		actualSteps = Math.min(actualSteps, maxSteps);
	}

	if (actualSteps === 1) {
		ret = [{p: .5, color: colorRange(.5)}];
	}
	else {
		let step = 1 / (actualSteps - 1);
		ret = Array.from({length: actualSteps}, (_, i) => {
			let p = i * step;
			return {p, color: colorRange(p)};
		});
	}

	if (maxDeltaE > 0) {
		// Iterate over all stops and find max deltaE
		let maxDelta = ret.reduce((acc, cur, i) => {
			if (i === 0) {
				return 0;
			}

			let deltaE = cur.color.deltaE(ret[i - 1].color, deltaEMethod);
			return Math.max(acc, deltaE);
		}, 0);

		while (maxDelta > maxDeltaE) {
			// Insert intermediate stops and measure maxDelta again
			// We need to do this for all pairs, otherwise the midpoint shifts
			maxDelta = 0;

			for (let i = 1; (i < ret.length) && (ret.length < maxSteps); i++) {
				let prev = ret[i - 1];
				let cur = ret[i];

				let p = (cur.p + prev.p) / 2;
				let color = colorRange(p);
				maxDelta = Math.max(maxDelta, color.deltaE(prev.color), color.deltaE(cur.color));
				ret.splice(i, 0, {p, color: colorRange(p)});
				i++;
			}
		}
	}

	ret = ret.map(a => a.color);

	return ret;
};

/**
 * Interpolate to color2 and return a function that takes a 0-1 percentage
 * @param {Color | string | Function} color1 The first color or an existing range
 * @param {Color | string} [color2] If color1 is a color, this is the second color
 * @param {Object} [options={}]
 * @returns {Function} A function that takes a 0-1 percentage and returns a color
 */
export function range (color1, color2, options = {}) {
	if (isRange(color1)) {
		// Tweaking existing range
		let [range, options] = [color1, color2];
		return range(...range.rangeArgs.colors, {...range.rangeArgs.options, ...options});
	}

	let {space, outputSpace, progression, premultiplied} = options;

	// Make sure we're working on copies of these colors
	color1 = new Color(color1);
	color2 = new Color(color2);


	let rangeArgs = {colors: [color1, color2], options};

	if (space) {
		space = Color.Space.get(space);
	}
	else {
		space = Color.Space.registry[defaults.interpolationSpace] || color1.space;
	}

	outputSpace = outputSpace? Color.space(outputSpace) : space;

	color1 = color1.to(space).toGamut();
	color2 = color2.to(space).toGamut();

	// Handle hue interpolation
	// See https://github.com/w3c/csswg-drafts/issues/4735#issuecomment-635741840
	if (space.coords.h && space.coords.h.type === "angle") {
		let arc = options.hue = options.hue || "shorter";

		let hue = [space, "h"];
		let [θ1, θ2] = [color1.get(hue), color2.get(hue)];
		[θ1, θ2] = angles.adjust(arc, [θ1, θ2]);
		color1.set(hue, θ1);
		color2.set(hue, θ2);
	}

	if (premultiplied) {
		// not coping with polar spaces yet
		color1.coords = color1.coords.map (c => c * color1.alpha);
		color2.coords = color2.coords.map (c => c * color2.alpha);
	}

	return Object.assign(p => {
		p = progression? progression(p) : p;
		let coords = color1.coords.map((start, i) => {
			let end = color2.coords[i];
			return interpolate(start, end, p);
		});
		let alpha = interpolate(color1.alpha, color2.alpha, p);
		let ret = new Color(space, coords, alpha);

		if (premultiplied) {
			// undo premultiplication
			ret.coords = ret.coords.map(c => c / alpha);
		}

		if (outputSpace !== space) {
			ret = ret.to(outputSpace);
		}

		return ret;
	}, {
		rangeArgs
	});
};

export function isRange (val) {
	return type(val) === "function" && val.rangeArgs;
};

defaults.interpolationSpace = "lab";

let exports = {mix, range, steps};

for (let name in exports) {
	Color[name] = exports[name];
	Color.prototype[name] = function(...args) {
		return exports[name](this, ...args);
	}
}