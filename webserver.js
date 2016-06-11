#!/usr/bin/env node

//webserver to control a heating

//general
//====================================================
const NUM_SENSORS = 5;

//modules
//====================================================

const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const fs = require('fs'); //file-system
const exec = require('shelljs').exec;
const serial = require('serialport-js');

//paths
//====================================================
const rootDir = '/root/heating/'
const fileHeader = rootDir + 'header.html';
const fileFooter = rootDir + 'footer.html';
const fileIndex = rootDir + 'index.html';
const fileLED = '/sys/class/leds/led0/brightness'; //for RaspberryPi
const dirGPIO = 'sys/class/gpio/';
const svgStorage = rootDir + 'storage.svg';
const svgGraph = rootDir + 'graph.svg';

//color
//====================================================
const RGB_TEMP_MIN = 10;
const RGB_TEMP_MAX = 80;
const RGB_TEMP_DIFF = RGB_TEMP_MAX - RGB_TEMP_MIN
const RGBPerTemp = 255 / RGB_TEMP_DIFF;
const calcRGB = function(rgb_temperature) {
	if (rgb_temperature > RGB_TEMP_MAX) {
		rgb_temperature = RGB_TEMP_MAX;
	} else if (rgb_temperature < RGB_TEMP_MIN) {
		rgb_temperature = RGB_TEMP_MIN;
	}
	var rgb_red = Math.round((rgb_temperature - RGB_TEMP_MIN) * RGBPerTemp);
	return rgb_red + ', 0, ' + (255 - rgb_red); 	
};

//templating
//====================================================
const TEMPLATING_SIGN_BEGIN = '__{{';
const TEMPLATING_SIGN_END = '}}__';
const TEMPLATING_REGEX = /__\{\{\S*\}\}__/g;
const assemblePage = function(fileToEmbed) {
	var content = fs.readFileSync(fileHeader, 'utf-8') + fs.readFileSync(fileToEmbed, 'utf-8') + fs.readFileSync(fileFooter, 'utf-8');
	return content;
};
const fillWithVariables = function(string, variables) { //http://www.w3schools.com/jsref/jsref_obj_regexp.asp
	string = string.toString();
	var matches = string.match(TEMPLATING_REGEX);
	if (matches !== null) {
		for (i = 0; i < matches.length; i++) {
			var match = matches[i];
			match = match.replace(TEMPLATING_SIGN_BEGIN, '').replace(TEMPLATING_SIGN_END, '');
			var matchValue = variables[match];
			string = string.replace(matches[i], matchValue);
		}
	}
	return string;
};

//embedded
//====================================================
const toggleLED = function() {
	statusLED = 1 - statusLED;	
	fs.writeFileSync(fileLED, statusLED);
};
const initGPIO_Async = function(pin, direction) { //direction: 'in' or 'out' 
	fs.writeFile(dirGPIO + 'export', pin, function() {
		fs.writeFile(dirGPIO + 'gpio' + pin + '/' + 'direction', direction, function() {
		});
	});
};
const writeGPIO = function(gpio, value) {
	fs.writeFileSync(dirGPIO + 'gpio' + gpio + '/' + 'value', value);
};
const readGPIO = function(gpio) {
	return fs.readFileSync(dirGPIO + 'gpio' + gpio + '/' + 'value');
};
const updateTempCPU = function() {
	exec('/opt/vc/bin/vcgencmd measure_temp', function (error, stdout, stderr) {
		var temp = stdout;
		temp = temp.replace('temp=', '');
		temp = temp.replace("'C", '');
		properties.cpu_temp = temp;
		testArray[0].push(temp);
		if (testArray[0].length > 20) {
			testArray[0].shift();
		}
	});
};

//svg
//====================================================
var graph = {
	content: "",
	height: 0,
	width: 0,
	pDrawingArea_margin: 0,
	pDrawingArea_size: 0,
	value_min: 0,
	value_max: 0,
	value_diff: 0,
	value_steps: 0,
	label_annex: "",
	init: function(pValue_min, pValue_max, pValue_steps, pValue_annex) {
		this.height = 600;
		this.width = 1200;
		this.pDrawingArea_margin = 10;
		this.pDrawingArea_size = (100 - (2 * this.pDrawingArea_margin));
		this.value_min = pValue_min;
		this.value_max = pValue_max;
		this.value_diff = this.value_max - this.value_min;
		this.value_steps = pValue_steps;
		this.label_annex = pValue_annex;
	},
	initGraph: function() {
		const NUM_HORIZONTAL_LINES = (this.value_max - this.value_min) / this.value_steps;
		const PERCENT_PER_HORIZONTAL_LINE = this.pDrawingArea_size / NUM_HORIZONTAL_LINES;
		const label_steps = 2; //e.g. 2 means: only every 2nd line has a label
		const label_offset = -5;
		const label_fontsize = 3; //per cent
		var label_value = this.value_max;
		var cssClass = "";

		graph.content += graph.svgRect(this.pDrawingArea_margin + '%', this.pDrawingArea_margin + '%', this.pDrawingArea_size + '%' , this.pDrawingArea_size + '%', 'drawingArea');

		for (var i = 0; i <= NUM_HORIZONTAL_LINES; i++) {
			var height = this.pDrawingArea_margin + i * PERCENT_PER_HORIZONTAL_LINE; 
			if (i % label_steps == 0) {
				graph.content += graph.svgText((this.pDrawingArea_margin + label_offset) + '%', (height + label_fontsize / 2) + '%', label_value + this.label_annex);
			}
			if (label_value == 0) {
				cssClass = "fat";
			} else {
				cssClass = "";
			}
			graph.content += graph.svgLine(this.pDrawingArea_margin + '%', height + '%', (100 - this.pDrawingArea_margin) + '%', height + '%', cssClass);
			label_value -= this.value_steps;
		} 
	},
	svgLine: function(x1, y1, x2, y2, cssClass) {
		if (cssClass === undefined) {
			cssClass = '';
		}
		return '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" class="' + cssClass + '"/>';
	},
	svgRect: function(x, y, width, height, cssClass) {
		if (cssClass === undefined) {
			cssClass = '';
		}
		return '<rect x="' + x + '" y="' + y + '" width="' + width + '" height="' + height + '" class="' + cssClass + '"/>';
	},
	svgCircle: function(x, y, r, cssClass) {
		if (cssClass === undefined) {
			cssClass = '';
		}
		return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" class="' + cssClass + '"/>';
	},
	svgText: function(x, y, text, cssClass) {
		if (cssClass === undefined) {
			cssClass = '';
		}
		return '<text x="' + x + '" y="' + y + '" class="' + cssClass + '">' + text + '</text>';
	},
	svgPolyline: function(points, cssClass) {
		if (cssClass === undefined) {
			cssClass = '';
		}
		var sPoints = "";
		for (var i = 0; i < points.length; i++) {
			sPoints += points[i][0] + ',' + points[i][1] + ' ';
		}
		return '<polyline points="' + sPoints + '" class="' + cssClass + '"/>';
	},
	drawValues: function(values, colorIndex) {
		const absolute_margin_x = this.pDrawingArea_margin / 100 * this.width;
		const absolute_margin_y = this.pDrawingArea_margin / 100 * this.height;
		const absolute_width = this.pDrawingArea_size / 100 * this.width;
		const absolute_height = this.pDrawingArea_size / 100 * this.height;
		var points = new Array();
		for (var i = 0; i < values.length; i++) {
			points[i] = new Array();
			points[i][0] = (absolute_margin_x + i / (values.length - 1) * absolute_width);
			points[i][1] = (this.height - (absolute_margin_y + (values[i] - this.value_min) / this.value_diff * absolute_height));
			this.content += this.svgCircle(points[i][0], points[i][1], 5, 'color' + colorIndex);
		}
		this.content += this.svgPolyline(points, 'color' + colorIndex);
	},
	drawGraph: function(values) {
		this.content = "";
		this.initGraph();
		if (values[0].constructor === Array) {
			console.log("is array!");
			for (var i = 0; i < values.length; i++) {
				this.drawValues(values[i], i);
			}
		} else {
			this.drawValues(values, 0);
		}
	}	
};
graph.init(-20, 100, 10, '°C');

//global variables
//====================================================

const arrayLength = 20;
var testArray = new Array(6);
testArray[0] = new Array(arrayLength);
testArray[1] = new Array(arrayLength);
testArray[2] = new Array(arrayLength);
testArray[3] = new Array(arrayLength);
testArray[4] = new Array(arrayLength);
testArray[5] = new Array(arrayLength);

var statusLED = 0;
var properties = { //Object
	cpu_temp: 0,
	burner_status: 0,
	pump_status: 0,
	temp_outside: 0,
	temp_storage_top: 0,
	temp_storage_mid: 0,
	temp_storage_bot: 0,
	temp_to_heating_circle: 0
};
var storage = {
	temp_top: 0,
	temp_mid: 0,
	temp_bot: 0,
	rgb_top: "255, 255, 255",
	rgb_mid: "255, 255, 255",
	rgb_bot: "255, 255, 255"
};
var pinsIndex = { //Object
	LED: 0,
	pump: 1,
	burner: 2
};
var pins = [ //Array
	3,
	21,
	20
];
var sensors = [ //mapping of indexes to positions
	'temp_outside',
	'temp_storage_top',
	'temp_storage_mid',
	'temp_storage_bot',
	'temp_to_heating_circle'
];

//serialPort: https://www.npmjs.com/package/serialport2
//====================================================

serial.open('/dev/ttyACM0', start, '\n');

function start(port) {
	console.log("SerialPort opened");

	port.on('error', function(err) {
		console.log(err);
	});
 
	port.on('data', function(data) {
		var sData = data.toString();
		console.log(sData);
		var aData = sData.split(': ');
		if (aData[0] < NUM_SENSORS && aData.length == 2 && !isNaN(aData[0]) && !isNaN(aData[1]) && aData[1] !== undefined) {
			aData[0] = parseInt(aData[0]);
			aData[1] = parseInt(aData[1]);
			properties[sensors[aData[0]]] = aData[1];
			var index = aData[0] + 1;
			testArray[index].push(aData[1]);
			if (testArray[index].length > 20) {
				testArray[index].shift();
			}
		}
	});
};
 
//init
//====================================================

for (i = 0; i < pins.length; i++) {
	initGPIO_Async(pins[i], 'out');
}

//the temperature regulation
//====================================================

var main = function () {
	updateTempCPU();
	toggleLED(); //to visualize activity (like heartbeat, but only for this application)
};
setInterval(main, 1000);

//the normal webserver stuff
//====================================================

//app.use(bodyParser.urlencoded({extended: false}));

app.get('/', function (req, res) {
	res.contentType('text/html');
	res.send(fillWithVariables(assemblePage(fileIndex), properties));
});

app.get('/*.html', function (req, res) {
	res.contentType('text/html');
	res.send(fillWithVariables(assemblePage(rootDir + req.path), properties));
});

app.get('/*.css', function (req, res) {
	res.contentType('text/css');
	var filename = req.path;
	res.sendFile(rootDir + filename);
});

app.get('/storage.svg', function (req, res) {
	storage.temp_top = properties.temp_storage_top;
	storage.temp_mid = properties.temp_storage_mid;
	storage.temp_bot = properties.temp_storage_bot;
	storage.rgb_top = calcRGB(storage.temp_top); 
	storage.rgb_mid = calcRGB(storage.temp_mid);
	storage.rgb_bot = calcRGB(storage.temp_bot);
	
	res.contentType('image/svg+xml');
	var content = fs.readFileSync(svgStorage);
	content = fillWithVariables(content, storage);

	res.send(content);
});

app.get('/graph.svg', function (req, res) {
	graph.drawGraph(testArray);
	res.contentType('image/svg+xml');
	var content = fs.readFileSync(svgGraph);
	content = fillWithVariables(content, graph);
	res.send(content);
});

app.all('/pump', function (req, res) {
	properties.pump_status = 1 - properties.pump_status;
	writeGPIO(pins[pinsIndex.pump], properties.pump_status);
	console.log('pump');
	res.redirect(303, '/');
});

app.all('/burn', function (req, res) {
	properties.burner_status = 1 - properties.burner_status;
	writeGPIO(pins[pinsIndex.burner], properties.burner_status);
	console.log('burn');
	res.redirect(303, '/');
});

app.listen(80);
