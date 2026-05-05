/*!
 * SvgParser
 * A library to convert an SVG string to parse-able segments for CAD/CAM use
 * Licensed under the MIT license
 */
 
 (function(root){
	'use strict';
	
	function SvgParser(){
		// the SVG document
		this.svg;
		
		// the top level SVG element of the SVG document
		this.svgRoot;
		
		this.allowedElements = ['svg','circle','ellipse','path','polygon','polyline','rect', 'line'];
				
		this.conf = {
			tolerance: 2, // max bound for bezier->line segment conversion, in native SVG units
			toleranceSvg: 0.005 // fudge factor for browser inaccuracy in SVG unit handling
		}; 
	}
	
	SvgParser.prototype.config = function(config){
		this.conf.tolerance = config.tolerance;
	}
	
	SvgParser.prototype.load = function(svgString){
	
		if(!svgString || typeof svgString !== 'string'){
			throw Error('invalid SVG string');
		}
				
		var parser = new DOMParser();
		var svg = parser.parseFromString(svgString, "image/svg+xml");
		
		this.svgRoot = false;
		
		if(svg){
			this.svg = svg;
			
			for(var i=0; i<svg.childNodes.length; i++){
				// svg document may start with comments or text nodes
				var child = svg.childNodes[i];
				if(child.tagName && child.tagName == 'svg'){
					this.svgRoot = child;
					break;
				}
			}
		} else {
			throw new Error("Failed to parse SVG string");
		}

		if(!this.svgRoot){
			throw new Error("SVG has no children");
		}
		return this.svgRoot;
	}
	
	// use the utility functions in this class to prepare the svg for CAD-CAM/nest related operations
	SvgParser.prototype.cleanInput = function(){
	
		// apply any transformations, so that all path positions etc will be in the same coordinate space
		this.applyTransform(this.svgRoot);
		
		// remove any g elements and bring all elements to the top level
		this.flatten(this.svgRoot);
		
		// remove any non-contour elements like text
		this.filter(this.allowedElements);
		
		// split any compound paths into individual path elements
		this.recurse(this.svgRoot, this.splitPath);
		
		return this.svgRoot;

	}
	
	// return style node, if any
	SvgParser.prototype.getStyle = function(){
		if(!this.svgRoot){
			return false;
		}
		for(var i=0; i<this.svgRoot.childNodes.length; i++){
			var el = this.svgRoot.childNodes[i];
			if(el.tagName == 'style'){
				return el;
			}
		}
		
		return false;
	}
	
	// set the given path as absolute coords (capital commands)
	// from http://stackoverflow.com/a/9677915/433888
	SvgParser.prototype.pathToAbsolute = function(path){
		if(!path || path.tagName != 'path'){
			throw Error('invalid path');
		}
		
		var seglist = path.pathSegList;
		var x=0, y=0, x0=0, y0=0, x1=0, y1=0, x2=0, y2=0;
		
		for(var i=0; i<seglist.numberOfItems; i++){
			var command = seglist.getItem(i).pathSegTypeAsLetter;
			var s = seglist.getItem(i);

			if (/[MLHVCSQTA]/.test(command)){
			  if ('x' in s) x=s.x;
			  if ('y' in s) y=s.y;
			}
			else{
				if ('x1' in s) x1=x+s.x1;
				if ('x2' in s) x2=x+s.x2;
				if ('y1' in s) y1=y+s.y1;
				if ('y2' in s) y2=y+s.y2;
				if ('x'  in s) x+=s.x;
				if ('y'  in s) y+=s.y;
				switch(command){
					case 'm': seglist.replaceItem(path.createSVGPathSegMovetoAbs(x,y),i);                   break;
					case 'l': seglist.replaceItem(path.createSVGPathSegLinetoAbs(x,y),i);                   break;
					case 'h': seglist.replaceItem(path.createSVGPathSegLinetoHorizontalAbs(x),i);           break;
					case 'v': seglist.replaceItem(path.createSVGPathSegLinetoVerticalAbs(y),i);             break;
					case 'c': seglist.replaceItem(path.createSVGPathSegCurvetoCubicAbs(x,y,x1,y1,x2,y2),i); break;
					case 's': seglist.replaceItem(path.createSVGPathSegCurvetoCubicSmoothAbs(x,y,x2,y2),i); break;
					case 'q': seglist.replaceItem(path.createSVGPathSegCurvetoQuadraticAbs(x,y,x1,y1),i);   break;
					case 't': seglist.replaceItem(path.createSVGPathSegCurvetoQuadraticSmoothAbs(x,y),i);   break;
					case 'a': seglist.replaceItem(path.createSVGPathSegArcAbs(x,y,s.r1,s.r2,s.angle,s.largeArcFlag,s.sweepFlag),i);   break;
					case 'z': case 'Z': x=x0; y=y0; break;
				}
			}
			// Record the start of a subpath
			if (command=='M' || command=='m') x0=x, y0=y;
		}
	};
	
	// takes an SVG transform string and returns corresponding SVGMatrix
	// from https://github.com/fontello/svgpath
	SvgParser.prototype.transformParse = function(transformString){
		var operations = {
			matrix: true,
			scale: true,
			rotate: true,
			translate: true,
			skewX: true,
			skewY: true
		};

		var CMD_SPLIT_RE    = /\s*(matrix|translate|scale|rotate|skewX|skewY)\s*\(\s*(.+?)\s*\)[\s,]*/;
		var PARAMS_SPLIT_RE = /[\s,]+/;

		var matrix = new Matrix();
		var cmd, params;
		
		// Split value into ['', 'translate', '10 50', '', 'scale', '2', '', 'rotate',  '-45', '']
		transformString.split(CMD_SPLIT_RE).forEach(function (item) {

			// Skip empty elements
			if (!item.length) { return; }

			// remember operation
			if (typeof operations[item] !== 'undefined') {
			cmd = item;
			return;
			}

			// extract params & att operation to matrix
			params = item.split(PARAMS_SPLIT_RE).map(function (i) {
			return +i || 0;
			});

			// If params count is not correct - ignore command
			switch (cmd) {
				case 'matrix':
					if (params.length === 6) {
						matrix.matrix(params);
					}
					return;

				case 'scale':
					if (params.length === 1) {
						matrix.scale(params[0], params[0]);
					} else if (params.length === 2) {
						matrix.scale(params[0], params[1]);
					}
				return;

				case 'rotate':
					if (params.length === 1) {
						matrix.rotate(params[0], 0, 0);
					} else if (params.length === 3) {
						matrix.rotate(params[0], params[1], params[2]);
					}
				return;

				case 'translate':
					if (params.length === 1) {
						matrix.translate(params[0], 0);
					} else if (params.length === 2) {
						matrix.translate(params[0], params[1]);
					}
				return;

				case 'skewX':
					if (params.length === 1) {
						matrix.skewX(params[0]);
					}
				return;

				case 'skewY':
					if (params.length === 1) {
						matrix.skewY(params[0]);
					}
				return;
			}
		});

		return matrix;
	}
	
	// recursively apply the transform property to the given element
	SvgParser.prototype.applyTransform = function(element, globalTransform){
		
		globalTransform = globalTransform || '';

		var transformString = element.getAttribute('transform') || '';
		transformString = globalTransform + transformString;
		
		var transform, scale, rotate;

		if(transformString && transformString.length > 0){
			var transform = this.transformParse(transformString);
		}

		if(!transform){
			transform = new Matrix();
		}
		
		var tarray = transform.toArray();
		
		// decompose affine matrix to rotate, scale components (translate is just the 3rd column)
		var rotate = Math.atan2(tarray[1], tarray[3])*180/Math.PI;
		var scale = Math.sqrt(tarray[0]*tarray[0]+tarray[2]*tarray[2]);

		if(element.tagName == 'g' || element.tagName == 'svg' || element.tagName == 'defs' || element.tagName == 'clipPath'){
			element.removeAttribute('transform');
			var children = Array.prototype.slice.call(element.childNodes);

			for(var i=0; i<children.length; i++){
				if(children[i].tagName){ // skip text nodes
					this.applyTransform(children[i], transformString);
				}
			}
		}
		else if(transform && !transform.isIdentity()){
			const id = element.getAttribute('id')
			const className = element.getAttribute('class')

			switch(element.tagName){
				case 'ellipse':
					// the goal is to remove the transform property, but an ellipse without a transform will have no rotation
					// for the sake of simplicity, we will replace the ellipse with a path, and apply the transform to that path
					var path = this.svg.createElementNS(element.namespaceURI, 'path');
					var move = path.createSVGPathSegMovetoAbs(parseFloat(element.getAttribute('cx'))-parseFloat(element.getAttribute('rx')),element.getAttribute('cy'));
					var arc1 = path.createSVGPathSegArcAbs(parseFloat(element.getAttribute('cx'))+parseFloat(element.getAttribute('rx')),element.getAttribute('cy'),element.getAttribute('rx'),element.getAttribute('ry'),0,1,0);
					var arc2 = path.createSVGPathSegArcAbs(parseFloat(element.getAttribute('cx'))-parseFloat(element.getAttribute('rx')),element.getAttribute('cy'),element.getAttribute('rx'),element.getAttribute('ry'),0,1,0);
					
					path.pathSegList.appendItem(move);
					path.pathSegList.appendItem(arc1);
					path.pathSegList.appendItem(arc2);
					path.pathSegList.appendItem(path.createSVGPathSegClosePath());
					
					var transformProperty = element.getAttribute('transform');
					if(transformProperty){
						path.setAttribute('transform', transformProperty);
					}
					
					element.parentElement.replaceChild(path, element);

					element = path;

				case 'path':
					this.pathToAbsolute(element);
					var seglist = element.pathSegList;
					var prevx = 0;
					var prevy = 0;

					let transformedPath = '';
		
					for(var i=0; i<seglist.numberOfItems; i++){
						var s = seglist.getItem(i);
						var command = s.pathSegTypeAsLetter;
						

						if(command == 'H'){
							seglist.replaceItem(element.createSVGPathSegLinetoAbs(s.x,prevy),i);
							s = seglist.getItem(i);	
						}
						else if(command == 'V'){
							seglist.replaceItem(element.createSVGPathSegLinetoAbs(prevx,s.y),i);
							s = seglist.getItem(i);
						}
						// currently only works for uniform scale, no skew
						// todo: fully support arbitrary affine transforms...
						else if(command == 'A'){
							seglist.replaceItem(element.createSVGPathSegArcAbs(s.x,s.y,s.r1*scale,s.r2*scale,s.angle+rotate,s.largeArcFlag,s.sweepFlag),i);
							s = seglist.getItem(i);
						}

						const transPoints = {};
						
						if('x' in s && 'y' in s){
							var transformed = transform.calc(s.x, s.y);
							prevx = s.x;
							prevy = s.y;
							transPoints.x = transformed[0];
							transPoints.y = transformed[1];
						}
						if('x1' in s && 'y1' in s){
							var transformed = transform.calc(s.x1, s.y1);
							transPoints.x1 = transformed[0];
							transPoints.y1 = transformed[1];
						}
						if('x2' in s && 'y2' in s){
							var transformed = transform.calc(s.x2, s.y2);
							transPoints.x2 = transformed[0];
							transPoints.y2 = transformed[1];
						}

						let commandStringTransformed = ``;

						//MLHVCSQTA
						//H and V are transformed to "L" commands above so we don't need to handle them. All lowercase (relative) are already handled too (converted to absolute)
						switch(command) {
							case 'M':
								commandStringTransformed += `${command} ${transPoints.x} ${transPoints.y}`;
								break;
							case 'L':
								commandStringTransformed += `${command} ${transPoints.x} ${transPoints.y}`;
								break;
							case 'C': 
								commandStringTransformed += `${command} ${transPoints.x1} ${transPoints.y1}  ${transPoints.x2} ${transPoints.y2} ${transPoints.x} ${transPoints.y}`;
								break;
							case 'S': 
								commandStringTransformed += `${command} ${transPoints.x2} ${transPoints.y2} ${transPoints.x} ${transPoints.y}`;
								break;
							case 'Q':
								commandStringTransformed += `${command} ${transPoints.x1} ${transPoints.y1} ${transPoints.x} ${transPoints.y}`;
								break;
							case 'T': 
								commandStringTransformed += `${command} ${transPoints.x} ${transPoints.y}`;
								break;
							case 'A':
								const largeArcFlag = s.largeArcFlag ? 1 : 0;
								const sweepFlag = s.sweepFlag ? 1 : 0;
								commandStringTransformed += `${command} ${s.r1} ${s.r2} ${s.angle} ${largeArcFlag} ${sweepFlag} ${transPoints.x} ${transPoints.y}`
								break;
							case 'H':
								commandStringTransformed += `L ${transPoints.x} ${transPoints.y}`
								break;
							case 'V':
								commandStringTransformed += `L ${transPoints.x} ${transPoints.y}`
								break;
							case 'Z': 
							case 'z':
								commandStringTransformed += command;
								break;
							default: 
								console.log('FOUND COMMAND NOT HANDLED BY COMMAND STRING BUILDER', command);
								break;
						}

						transformedPath += commandStringTransformed;
					}
					
					element.setAttribute('d', transformedPath);
					element.removeAttribute('transform');
				break;
				case 'circle':
					var transformed = transform.calc(element.getAttribute('cx'), element.getAttribute('cy'));
					element.setAttribute('cx', transformed[0]);
					element.setAttribute('cy', transformed[1]);
					
					// skew not supported
					element.setAttribute('r', element.getAttribute('r')*scale);
				break;
				case 'line':
					const transformedStartPt = transform.calc(element.getAttribute('x1'), element.getAttribute('y1'));
					const transformedEndPt = transform.calc(element.getAttribute('x2'), element.getAttribute('y2'));
					element.setAttribute('x1', transformedStartPt[0].toString());
					element.setAttribute('y1', transformedStartPt[1].toString());
					element.setAttribute('x2', transformedEndPt[0].toString());
					element.setAttribute('y2', transformedEndPt[1].toString());
				break;
				case 'rect':
					// similar to the ellipse, we'll replace rect with polygon
					var polygon = this.svg.createElementNS(element.namespaceURI, 'polygon');
															
					var p1 = this.svgRoot.createSVGPoint();
					var p2 = this.svgRoot.createSVGPoint();
					var p3 = this.svgRoot.createSVGPoint();
					var p4 = this.svgRoot.createSVGPoint();
					
					p1.x = parseFloat(element.getAttribute('x')) || 0;
					p1.y = parseFloat(element.getAttribute('y')) || 0;
					
					p2.x = p1.x + parseFloat(element.getAttribute('width'));
					p2.y = p1.y;
					
					p3.x = p2.x;
					p3.y = p1.y + parseFloat(element.getAttribute('height'));
					
					p4.x = p1.x;
					p4.y = p3.y;
					
					polygon.points.appendItem(p1);
					polygon.points.appendItem(p2);
					polygon.points.appendItem(p3);
					polygon.points.appendItem(p4);
					
					var transformProperty = element.getAttribute('transform');
					if(transformProperty){
						polygon.setAttribute('transform', transformProperty);
					}
					
					element.parentElement.replaceChild(polygon, element);
					element = polygon;
				case 'polygon':
				case 'polyline':
					let transformedPoly = ''
					for(var i=0; i<element.points.numberOfItems; i++){
						var point = element.points.getItem(i);
						var transformed = transform.calc(point.x, point.y);
						const pointPairString = `${transformed[0]},${transformed[1]} `;
						transformedPoly += pointPairString;
					}
					
					element.setAttribute('points', transformedPoly);
					element.removeAttribute('transform');
				break;
			}
			if(id) {
				element.setAttribute('id', id);
			}
			if(className){
				element.setAttribute('class', className);
			}
		}
	}
	
	// bring all child elements to the top level
	SvgParser.prototype.flatten = function(element){
		
		for(var i=0; i<element.childNodes.length; i++){
			this.flatten(element.childNodes[i]);
		}
		
		if(element.tagName != 'svg'){
			while(element.childNodes.length > 0){
				element.parentElement.appendChild(element.childNodes[0]);
			}
		}
	}
	
	// remove all elements with tag name not in the whitelist
	// use this to remove <text>, <g> etc that don't represent shapes
	SvgParser.prototype.filter = function(whitelist, element){
		if(!whitelist || whitelist.length == 0){
			throw Error('invalid whitelist');
		}
		
		element = element || this.svgRoot;
		
		for(var i=0; i<element.childNodes.length; i++){
			this.filter(whitelist, element.childNodes[i]);
		}
		
		if(element.childNodes.length == 0 && whitelist.indexOf(element.tagName) < 0){
			element.parentElement.removeChild(element);
		}
	}
	
	// split a compound path (paths with M, m commands) into an array of paths
	SvgParser.prototype.splitPath = function(path){
		if(!path || path.tagName != 'path' || !path.parentElement){
			return false;
		}
		
		var seglist = [];
		
		// make copy of seglist (appending to new path removes it from the original pathseglist)
		for(var i=0; i<path.pathSegList.numberOfItems; i++){
		    seglist.push(path.pathSegList.getItem(i));
		}

		var x=0, y=0, x0=0, y0=0;
		var paths = [];
		
		var p;
		
		var lastM = 0;
		for(var i=seglist.length-1; i>=0; i--){
			if(i > 0 && seglist[i].pathSegTypeAsLetter == 'M' || seglist[i].pathSegTypeAsLetter == 'm'){
				lastM = i;
				break;
			}
		}
		
		if(lastM == 0){
			return false; // only 1 M command, no need to split
		}
		
		for( i=0; i<seglist.length; i++){
			var s = seglist[i];
			var command = s.pathSegTypeAsLetter;

			if(command == 'M' || command == 'm'){
				p = path.cloneNode();
				p.setAttribute('d','');
				paths.push(p);
			}
			
			if (/[MLHVCSQTA]/.test(command)){
			  if ('x' in s) x=s.x;
			  if ('y' in s) y=s.y;

			  p.pathSegList.appendItem(s);
			}
			else{
				if ('x'  in s) x+=s.x;
				if ('y'  in s) y+=s.y;
				if(command == 'm'){
					p.pathSegList.appendItem(path.createSVGPathSegMovetoAbs(x,y));
				}
				else{
					if(command == 'Z' || command == 'z'){
						x = x0;
						y = y0;
					}
					p.pathSegList.appendItem(s);
				}
			}
			// Record the start of a subpath
			if (command=='M' || command=='m'){
				x0=x, y0=y;
			}
		}
		
		var addedPaths = [];
		for(i=0; i<paths.length; i++){
			// don't add trivial paths from sequential M commands
			if(paths[i].pathSegList.numberOfItems > 1){
				path.parentElement.insertBefore(paths[i], path);
				addedPaths.push(paths[i]);
			}
		}
		
		path.remove();

		return addedPaths;
	}
	
	// recursively run the given function on the given element
	SvgParser.prototype.recurse = function(element, func){
		// only operate on original DOM tree, ignore any children that are added. Avoid infinite loops
		var children = Array.prototype.slice.call(element.childNodes);
		for(var i=0; i<children.length; i++){
			this.recurse(children[i], func);
		}
		
		func(element);
	}
	
	// return a polygon from the given SVG element in the form of an array of points
	SvgParser.prototype.polygonify = function(element){
		var poly = [];
		var i;

		switch(element.tagName){
			case 'polygon':
			case 'polyline':
				for(i=0; i<element.points.numberOfItems; i++){
					var point = element.points.getItem(i);
					poly.push({ x: point.x, y: point.y });
				}
			break;
			case 'rect':
				var p1 = {};
				var p2 = {};
				var p3 = {};
				var p4 = {};
				
				p1.x = parseFloat(element.getAttribute('x')) || 0;
				p1.y = parseFloat(element.getAttribute('y')) || 0;
				
				p2.x = p1.x + parseFloat(element.getAttribute('width'));
				p2.y = p1.y;
				
				p3.x = p2.x;
				p3.y = p1.y + parseFloat(element.getAttribute('height'));
				
				p4.x = p1.x;
				p4.y = p3.y;
				
				poly.push(p1);
				poly.push(p2);
				poly.push(p3);
				poly.push(p4);
			break;
			case 'circle':				
				var radius = parseFloat(element.getAttribute('r'));
				var cx = parseFloat(element.getAttribute('cx'));
				var cy = parseFloat(element.getAttribute('cy'));
				
				// num is the smallest number of segments required to approximate the circle to the given tolerance
				var num = Math.ceil((2*Math.PI)/Math.acos(1 - (this.conf.tolerance/radius)));
				
				if(num < 3){
					num = 3;
				}
				
				for(var i=0; i<num; i++){
					var theta = i * ( (2*Math.PI) / num);
					var point = {};
					point.x = radius*Math.cos(theta) + cx;
					point.y = radius*Math.sin(theta) + cy;
					
					poly.push(point);
				}
			break;
			case 'ellipse':				
				// same as circle case. There is probably a way to reduce points but for convenience we will just flatten the equivalent circular polygon
				var rx = parseFloat(element.getAttribute('rx'))
				var ry = parseFloat(element.getAttribute('ry'));
				var maxradius = Math.max(rx, ry);
				
				var cx = parseFloat(element.getAttribute('cx'));
				var cy = parseFloat(element.getAttribute('cy'));
				
				var num = Math.ceil((2*Math.PI)/Math.acos(1 - (this.conf.tolerance/maxradius)));
				
				if(num < 3){
					num = 3;
				}
				
				for(var i=0; i<num; i++){
					var theta = i * ( (2*Math.PI) / num);
					var point = {};
					point.x = rx*Math.cos(theta) + cx;
					point.y = ry*Math.sin(theta) + cy;
					
					poly.push(point);
				}
			break;
			case 'path':
				// we'll assume that splitpath has already been run on this path, and it only has one M/m command 
				var seglist = element.pathSegList;

				var firstCommand = seglist.getItem(0);
				var lastCommand = seglist.getItem(seglist.numberOfItems-1);

				var x=0, y=0, x0=0, y0=0, x1=0, y1=0, x2=0, y2=0, prevx=0, prevy=0, prevx1=0, prevy1=0, prevx2=0, prevy2=0;
				
				for(var i=0; i<seglist.numberOfItems; i++){
					var s = seglist.getItem(i);
					var command = s.pathSegTypeAsLetter;
					
					prevx = x;
					prevy = y;
					
					prevx1 = x1;
					prevy1 = y1;
					
					prevx2 = x2;
					prevy2 = y2;
					
					if (/[MLHVCSQTA]/.test(command)){
						if ('x1' in s) x1=s.x1;
						if ('x2' in s) x2=s.x2;
						if ('y1' in s) y1=s.y1;
						if ('y2' in s) y2=s.y2;
						if ('x' in s) x=s.x;
						if ('y' in s) y=s.y;
					}
					else{
						if ('x1' in s) x1=x+s.x1;
						if ('x2' in s) x2=x+s.x2;
						if ('y1' in s) y1=y+s.y1;
						if ('y2' in s) y2=y+s.y2;							
						if ('x'  in s) x+=s.x;
						if ('y'  in s) y+=s.y;
					}
					switch(command){
						// linear line types
						case 'm':
						case 'M':
						case 'l':
						case 'L':
						case 'h':
						case 'H':
						case 'v':
						case 'V':
							var point = {};
							point.x = x;
							point.y = y;
							poly.push(point);
						break;
						// Quadratic Beziers
						case 't':
						case 'T':
						// implicit control point
						if(i > 0 && /[QqTt]/.test(seglist.getItem(i-1).pathSegTypeAsLetter)){
							x1 = prevx + (prevx-prevx1);
							y1 = prevy + (prevy-prevy1);
						}
						else{
							x1 = prevx;
							y1 = prevy;
						}
						case 'q':
						case 'Q':
							var pointlist = GeometryUtil.QuadraticBezier.linearize({x: prevx, y: prevy}, {x: x, y: y}, {x: x1, y: y1}, this.conf.tolerance);
							pointlist.shift(); // firstpoint would already be in the poly
							for(var j=0; j<pointlist.length; j++){
								var point = {};
								point.x = pointlist[j].x;
								point.y = pointlist[j].y;
								poly.push(point);
							}
						break;
						case 's':
						case 'S':
							if(i > 0 && /[CcSs]/.test(seglist.getItem(i-1).pathSegTypeAsLetter)){
								x1 = prevx + (prevx-prevx2);
								y1 = prevy + (prevy-prevy2);
							}
							else{
								x1 = prevx;
								y1 = prevy;
							}
						case 'c':
						case 'C':
							var pointlist = GeometryUtil.CubicBezier.linearize({x: prevx, y: prevy}, {x: x, y: y}, {x: x1, y: y1}, {x: x2, y: y2}, this.conf.tolerance);
							pointlist.shift(); // firstpoint would already be in the poly
							for(var j=0; j<pointlist.length; j++){
								var point = {};
								point.x = pointlist[j].x;
								point.y = pointlist[j].y;
								poly.push(point);
							}
						break;
						case 'a':
						case 'A':
							var pointlist = GeometryUtil.Arc.linearize({x: prevx, y: prevy}, {x: x, y: y}, s.r1, s.r2, s.angle, s.largeArcFlag,s.sweepFlag, this.conf.tolerance);
							pointlist.shift();
							
							for(var j=0; j<pointlist.length; j++){
								var point = {};
								point.x = pointlist[j].x;
								point.y = pointlist[j].y;
								poly.push(point);
							}
						break;
						case 'z': case 'Z': x=x0; y=y0; break;
					}
					// Record the start of a subpath
					if (command=='M' || command=='m') x0=x, y0=y;
				}
				
			break;
		}
		
		// do not include last point if coincident with starting point
		while(poly.length > 0 && GeometryUtil.almostEqual(poly[0].x,poly[poly.length-1].x, this.conf.toleranceSvg) && GeometryUtil.almostEqual(poly[0].y,poly[poly.length-1].y, this.conf.toleranceSvg)){
			poly.pop();
		}

		return poly;
	};

	function DxfParser(){
		this.dxfText = null;
		this.entities = [];
		this.svgRoot = null;
		this.conf = {
			vertexSampleCount: 32
		};
	}

	DxfParser.prototype.load = function(dxfString){
		if(!dxfString || typeof dxfString !== 'string'){
			throw Error('invalid DXF string');
		}

		this.dxfText = dxfString;
		var groups = this.parseGroups(dxfString);
		var sections = this.parseSections(groups);
		this.entities = this.parseEntities(sections['ENTITIES'] || []);
		this.svgRoot = this.buildSvg(this.entities);
		return this.svgRoot;
	};

	DxfParser.prototype.parseGroups = function(text){
		var lines = text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n');
		var groups = [];
		for(var i=0; i<lines.length;){
			var code = lines[i].trim();
			i++;
			if(!code){
				continue;
			}
			var value = '';
			while(i<lines.length && lines[i].trim() === ''){
				i++;
			}
			if(i < lines.length){
				value = lines[i].replace(/\r|\n/g,'');
			}
			groups.push({code: code, value: value});
			i++;
		}
		return groups;
	};

	DxfParser.prototype.parseSections = function(groups){
		var sections = {};
		var currentSection = null;
		var inSection = false;

		for(var i=0; i<groups.length; i++){
			var group = groups[i];
			if(group.code === '0'){
				if(group.value === 'SECTION'){
					inSection = true;
					currentSection = null;
					continue;
				}
				if(group.value === 'ENDSEC'){
					inSection = false;
					currentSection = null;
					continue;
				}
			}

			if(inSection && group.code === '2'){
				currentSection = group.value;
				sections[currentSection] = [];
				continue;
			}

			if(inSection && currentSection){
				sections[currentSection].push(group);
			}
		}

		return sections;
	};

	DxfParser.prototype.parseEntities = function(groups){
		var entities = [];
		var current = null;

		for(var i=0; i<groups.length; i++){
			var group = groups[i];
			if(group.code === '0'){
				if(current){
					entities.push(current);
				}
				current = { type: group.value, data: [] };
			}
			else if(current){
				current.data.push(group);
			}
		}

		if(current){
			entities.push(current);
		}

		var parsed = [];
		for(var j=0; j<entities.length; j++){
			var entity = entities[j];
			switch(entity.type){
				case 'LINE':
					parsed.push(this.parseLine(entity.data));
					break;
				case 'LWPOLYLINE':
					parsed.push(this.parseLwPolyline(entity.data));
					break;
				case 'POLYLINE':
					parsed.push(this.parsePolylineBlock(entity, entities, j));
					break;
				case 'CIRCLE':
					parsed.push(this.parseCircle(entity.data));
					break;
				case 'ARC':
					parsed.push(this.parseArc(entity.data));
					break;
				case 'ELLIPSE':
					parsed.push(this.parseEllipse(entity.data));
					break;
				default:
					break;
			}
		}

		return parsed.filter(function(item){ return !!item; });
	};

	DxfParser.prototype.parseLine = function(data){
		return {
			type: 'LINE',
			x1: this.getNumber(data,'10',0),
			y1: this.getNumber(data,'20',0),
			x2: this.getNumber(data,'11',0),
			y2: this.getNumber(data,'21',0)
		};
	};

	DxfParser.prototype.parseLwPolyline = function(data){
		var vertices = [];
		var closed = (this.getNumber(data,'70',0) & 1) === 1;
		for(var i=0; i<data.length; i++){
			if(data[i].code === '10'){
				vertices.push({ x: this.getNumber(data,'10',0, i), y: this.getNumber(data,'20',0, i) });
			}
		}
		return { type:'POLYLINE', vertices: vertices, closed: closed };
	};

	DxfParser.prototype.parsePolylineBlock = function(entity, entities, index){
		var vertices = [];
		var closed = (this.getNumber(entity.data,'70',0) & 1) === 1;
		var k = index + 1;
		while(k < entities.length && entities[k].type === 'VERTEX'){
			vertices.push({ x: this.getNumber(entities[k].data,'10',0), y: this.getNumber(entities[k].data,'20',0) });
			k++;
		}
		return { type:'POLYLINE', vertices: vertices, closed: closed };
	};

	DxfParser.prototype.parseCircle = function(data){
		return {
			type:'CIRCLE',
			cx: this.getNumber(data,'10',0),
			cy: this.getNumber(data,'20',0),
			r: this.getNumber(data,'40',0)
		};
	};

	DxfParser.prototype.parseArc = function(data){
		return {
			type:'ARC',
			cx: this.getNumber(data,'10',0),
			cy: this.getNumber(data,'20',0),
			r: this.getNumber(data,'40',0),
			startAngle: this.getNumber(data,'50',0),
			endAngle: this.getNumber(data,'51',0)
		};
	};

	DxfParser.prototype.parseEllipse = function(data){
		return {
			type:'ELLIPSE',
			cx: this.getNumber(data,'10',0),
			cy: this.getNumber(data,'20',0),
			majorX: this.getNumber(data,'11',0),
			majorY: this.getNumber(data,'21',0),
			ratio: this.getNumber(data,'40',0),
			startParam: this.getNumber(data,'41',0),
			endParam: this.getNumber(data,'42',0)
		};
	};

	DxfParser.prototype.getNumber = function(data, code, fallback, startIndex){
		startIndex = startIndex || 0;
		for(var i=startIndex; i<data.length; i++){
			if(data[i].code === code){
				var value = parseFloat(data[i].value);
				return isNaN(value) ? fallback : value;
			}
		}
		return fallback;
	};

	DxfParser.prototype.buildSvg = function(entities){
		var svgNS = 'http://www.w3.org/2000/svg';
		var doc = new DOMParser().parseFromString('<svg xmlns="' + svgNS + '"></svg>','image/svg+xml');
		var svg = doc.documentElement;
		var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

		function updateBounds(x,y){
			minX = Math.min(minX, x);
			minY = Math.min(minY, y);
			maxX = Math.max(maxX, x);
			maxY = Math.max(maxY, y);
		}

		function addShape(shape){
			var element = null;
			if(shape.type === 'LINE'){
				element = doc.createElementNS(svgNS, 'path');
				element.setAttribute('d', 'M ' + shape.x1 + ' ' + shape.y1 + ' L ' + shape.x2 + ' ' + shape.y2);
				updateBounds(shape.x1, shape.y1);
				updateBounds(shape.x2, shape.y2);
			}
			else if(shape.type === 'POLYLINE'){
				if(!shape.vertices.length){
					return;
				}
				element = doc.createElementNS(svgNS, 'path');
				var d = 'M ' + shape.vertices[0].x + ' ' + shape.vertices[0].y;
				updateBounds(shape.vertices[0].x, shape.vertices[0].y);
				for(var i=1; i<shape.vertices.length; i++){
					d += ' L ' + shape.vertices[i].x + ' ' + shape.vertices[i].y;
					updateBounds(shape.vertices[i].x, shape.vertices[i].y);
				}
				if(shape.closed){
					d += ' Z';
				}
				element.setAttribute('d', d);
			}
			else if(shape.type === 'CIRCLE'){
				element = doc.createElementNS(svgNS, 'circle');
				element.setAttribute('cx', shape.cx);
				element.setAttribute('cy', shape.cy);
				element.setAttribute('r', shape.r);
				updateBounds(shape.cx - shape.r, shape.cy - shape.r);
				updateBounds(shape.cx + shape.r, shape.cy + shape.r);
			}
			else if(shape.type === 'ARC'){
				element = doc.createElementNS(svgNS, 'path');
				var start = this.pointOnCircle(shape.cx, shape.cy, shape.r, shape.startAngle);
				var end = this.pointOnCircle(shape.cx, shape.cy, shape.r, shape.endAngle);
				var delta = shape.endAngle - shape.startAngle;
				if(delta <= 0){
					delta += 360;
				}
				var largeArc = delta > 180 ? 1 : 0;
				var d = 'M ' + start.x + ' ' + start.y + ' A ' + shape.r + ' ' + shape.r + ' 0 ' + largeArc + ' 1 ' + end.x + ' ' + end.y;
				element.setAttribute('d', d);
				updateBounds(start.x, start.y);
				updateBounds(end.x, end.y);
			}
			else if(shape.type === 'ELLIPSE'){
				element = doc.createElementNS(svgNS, 'path');
				var points = this.approximateEllipse(shape);
				if(!points.length){
					return;
				}
				var d = 'M ' + points[0].x + ' ' + points[0].y;
				updateBounds(points[0].x, points[0].y);
				for(var j=1; j<points.length; j++){
					d += ' L ' + points[j].x + ' ' + points[j].y;
					updateBounds(points[j].x, points[j].y);
				}
				d += ' Z';
				element.setAttribute('d', d);
			}

			if(element){
				svg.appendChild(element);
			}
		};

		for(var i=0; i<entities.length; i++){
			addShape.call(this, entities[i]);
		}

		if(minX === Infinity){
			minX = 0; minY = 0; maxX = 1; maxY = 1;
		}

		svg.setAttribute('viewBox', minX + ' ' + minY + ' ' + (maxX - minX) + ' ' + (maxY - minY));
		return svg;
	};

	DxfParser.prototype.pointOnCircle = function(cx, cy, r, angleDegrees){
		var radians = angleDegrees * Math.PI / 180;
		return {
			x: cx + r * Math.cos(radians),
			y: cy + r * Math.sin(radians)
		};
	};

	DxfParser.prototype.approximateEllipse = function(shape){
		var points = [];
		var count = this.conf.vertexSampleCount;
		var startParam = shape.startParam;
		var endParam = shape.endParam;
		if(endParam <= startParam){
			endParam += 2 * Math.PI;
		}
		var major = {x: shape.majorX, y: shape.majorY};
		var minor = {x: -shape.majorY * shape.ratio, y: shape.majorX * shape.ratio};
		for(var i=0; i<=count; i++){
			var t = startParam + (endParam - startParam) * (i / count);
			points.push({
				x: shape.cx + major.x * Math.cos(t) + minor.x * Math.sin(t),
				y: shape.cy + major.y * Math.cos(t) + minor.y * Math.sin(t)
			});
		}
		return points;
	};

	DxfParser.prototype.toSvgString = function(){
		if(!this.svgRoot){
			return '';
		}
		return new XMLSerializer().serializeToString(this.svgRoot);
	};

	DxfParser.prototype.getSvgRoot = function(){
		return this.svgRoot;
	};

	// expose public methods
	var parser = new SvgParser();
	var dxfParser = new DxfParser();

	root.SvgParser = {
		config: parser.config.bind(parser),
		load: parser.load.bind(parser),
		getStyle: parser.getStyle.bind(parser),
		clean: parser.cleanInput.bind(parser),
		polygonify: parser.polygonify.bind(parser)
	};

	root.DxfParser = {
		load: dxfParser.load.bind(dxfParser),
		toSvgString: dxfParser.toSvgString.bind(dxfParser),
		getSvgRoot: dxfParser.getSvgRoot.bind(dxfParser)
	};

}(window));