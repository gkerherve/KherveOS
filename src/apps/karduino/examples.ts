// kArduino's built-in examples and snippets (pure data: no React, no "@/" imports).
// Every example is for an Arduino Uno unless it says otherwise; `wiring` is shown in the
// Wiring panel, `libraries` are the names to install with Tools > Manage libraries.

export interface Example {
  id: string
  title: string
  category: string
  description: string
  /** Fully qualified board name. */
  board: string
  wiring: string
  libraries: string[]
  code: string
}

export interface Snippet {
  id: string
  title: string
  /** Inserted at the cursor. */
  code: string
}

const UNO = 'arduino:avr:uno'

export const EXAMPLES: Example[] = [
  {
    id: 'blink', title: 'Blink', category: 'Basics', board: UNO, libraries: [],
    description: 'Blinks the built-in LED and reports it on the serial monitor.',
    wiring: 'Nothing to wire: the built-in LED (pin 13 on an Uno or Nano) blinks.\nFor an external LED: pin 13 -> 220 ohm resistor -> LED long leg (anode); LED short leg -> GND.',
    code: `// Blink: the built-in LED on pin 13 blinks once a second.
void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  digitalWrite(LED_BUILTIN, HIGH);
  Serial.println("on");
  delay(500);
  digitalWrite(LED_BUILTIN, LOW);
  Serial.println("off");
  delay(500);
}
`,
  },
  {
    id: 'fade', title: 'Fade (PWM)', category: 'Basics', board: UNO, libraries: [],
    description: 'Fades an LED up and down with analogWrite (PWM).',
    wiring: 'Pin 9 (a PWM pin, marked ~) -> 220 ohm resistor -> LED anode; LED cathode -> GND.\nPWM pins on an Uno: 3, 5, 6, 9, 10, 11.',
    code: `// Fade: the brightness of an LED goes up and down using PWM.
const int ledPin = 9;
int brightness = 0;
int step = 5;

void setup() {
  pinMode(ledPin, OUTPUT);
}

void loop() {
  analogWrite(ledPin, brightness);
  brightness += step;
  if (brightness <= 0 || brightness >= 255) {
    step = -step;
  }
  delay(30);
}
`,
  },
  {
    id: 'button', title: 'Button with pull-up', category: 'Basics', board: UNO, libraries: [],
    description: 'Lights the LED while a button is pressed, using the internal pull-up resistor.',
    wiring: 'Button between pin 2 and GND (no external resistor: INPUT_PULLUP keeps the pin HIGH until the button pulls it to GND).\nLED: pin 13 (built-in) or pin 8 -> 220 ohm -> LED -> GND.',
    code: `// Button: pressed = LOW, because of INPUT_PULLUP.
const int buttonPin = 2;
const int ledPin = 13;

void setup() {
  pinMode(buttonPin, INPUT_PULLUP);
  pinMode(ledPin, OUTPUT);
}

void loop() {
  bool pressed = digitalRead(buttonPin) == LOW;
  digitalWrite(ledPin, pressed ? HIGH : LOW);
}
`,
  },
  {
    id: 'debounce', title: 'Debounce a button', category: 'Basics', board: UNO, libraries: [],
    description: 'Toggles an LED on each clean button press, ignoring contact bounce.',
    wiring: 'Button between pin 2 and GND (INPUT_PULLUP). LED on pin 13 (built-in).',
    code: `// Debounce: a press counts only when the reading is stable for 50 ms.
const int buttonPin = 2;
const int ledPin = 13;
const unsigned long debounceMs = 50;

int ledState = LOW;
int lastReading = HIGH;
int stableState = HIGH;
unsigned long lastChange = 0;

void setup() {
  pinMode(buttonPin, INPUT_PULLUP);
  pinMode(ledPin, OUTPUT);
}

void loop() {
  int reading = digitalRead(buttonPin);
  if (reading != lastReading) {
    lastChange = millis();
    lastReading = reading;
  }
  if (millis() - lastChange > debounceMs && reading != stableState) {
    stableState = reading;
    if (stableState == LOW) {
      ledState = !ledState;
      digitalWrite(ledPin, ledState);
    }
  }
}
`,
  },
  {
    id: 'echo', title: 'Serial echo', category: 'Serial', board: UNO, libraries: [],
    description: 'Sends back every line you type in the serial monitor.',
    wiring: 'Nothing to wire. Connect the serial monitor at 9600 baud and send a line.',
    code: `// Serial echo: type a line in the serial monitor and the board repeats it.
void setup() {
  Serial.begin(9600);
  Serial.println("Type something and press Send.");
}

void loop() {
  if (Serial.available() > 0) {
    String line = Serial.readStringUntil('\\n');
    line.trim();
    Serial.print("You said: ");
    Serial.println(line);
  }
}
`,
  },
  {
    id: 'plotter-demo', title: 'Serial plotter demo', category: 'Serial', board: UNO, libraries: [],
    description: 'Prints two labelled waves, ready for the serial plotter (label:value pairs).',
    wiring: 'Nothing to wire. Open the Serial plotter and connect at 115200 baud.',
    code: `// Two waves in the label:value format the serial plotter understands.
void setup() {
  Serial.begin(115200);
}

void loop() {
  float t = millis() / 1000.0;
  Serial.print("sin:");
  Serial.print(sin(t * 2.0));
  Serial.print(",cos:");
  Serial.println(cos(t * 2.0));
  delay(20);
}
`,
  },
  {
    id: 'analog-plot', title: 'Analog read to the plotter', category: 'Sensors', board: UNO, libraries: [],
    description: 'Reads A0 and prints the value, one number per line, for the serial plotter.',
    wiring: 'Potentiometer: one outer pin -> 5V, the other outer pin -> GND, the middle pin (wiper) -> A0.\nOr leave A0 open to see noise.',
    code: `// Analog read: 0 to 1023 on A0, printed for the serial plotter.
const int sensorPin = A0;

void setup() {
  Serial.begin(115200);
}

void loop() {
  int value = analogRead(sensorPin);
  Serial.println(value);
  delay(10);
}
`,
  },
  {
    id: 'ldr', title: 'Light sensor (LDR)', category: 'Sensors', board: UNO, libraries: [],
    description: 'Reads a light-dependent resistor and switches an LED on when it gets dark.',
    wiring: 'LDR between 5V and A0; a 10 kohm resistor between A0 and GND (a voltage divider).\nLED: pin 9 -> 220 ohm -> LED -> GND.',
    code: `// LDR: the darker it is, the lower the reading (with the LDR on the 5V side).
const int ldrPin = A0;
const int ledPin = 9;
const int darkLevel = 400;

void setup() {
  pinMode(ledPin, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  int light = analogRead(ldrPin);
  bool dark = light < darkLevel;
  digitalWrite(ledPin, dark ? HIGH : LOW);
  Serial.print("light:");
  Serial.println(light);
  delay(100);
}
`,
  },
  {
    id: 'pot-led', title: 'Potentiometer controls an LED', category: 'Sensors', board: UNO, libraries: [],
    description: 'The knob sets the brightness of an LED: analogRead mapped to analogWrite.',
    wiring: 'Potentiometer: outer pins -> 5V and GND, wiper -> A0.\nLED: pin 9 (PWM) -> 220 ohm -> LED -> GND.',
    code: `// Potentiometer to LED brightness.
const int potPin = A0;
const int ledPin = 9;

void setup() {
  pinMode(ledPin, OUTPUT);
}

void loop() {
  int reading = analogRead(potPin);
  int brightness = map(reading, 0, 1023, 0, 255);
  analogWrite(ledPin, brightness);
}
`,
  },
  {
    id: 'servo', title: 'Servo sweep', category: 'Motors', board: UNO, libraries: ['Servo'],
    description: 'Sweeps a hobby servo from 0 to 180 degrees and back.',
    wiring: 'Servo signal (orange/yellow) -> pin 9; red -> 5V; brown/black -> GND.\nFor bigger servos use an external 5 V supply and join its GND with the Arduino GND.',
    code: `#include <Servo.h>

// Servo sweep: the library Servo comes with the Arduino IDE.
Servo servo;
const int servoPin = 9;

void setup() {
  servo.attach(servoPin);
}

void loop() {
  for (int angle = 0; angle <= 180; angle += 2) {
    servo.write(angle);
    delay(15);
  }
  for (int angle = 180; angle >= 0; angle -= 2) {
    servo.write(angle);
    delay(15);
  }
}
`,
  },
  {
    id: 'hcsr04', title: 'Ultrasonic distance (HC-SR04)', category: 'Sensors', board: UNO, libraries: [],
    description: 'Measures a distance in centimetres with an HC-SR04 and prints it.',
    wiring: 'HC-SR04: VCC -> 5V, GND -> GND, TRIG -> pin 9, ECHO -> pin 10.',
    code: `// HC-SR04: a 10 microsecond pulse on TRIG, the ECHO pulse length gives the distance.
const int trigPin = 9;
const int echoPin = 10;

void setup() {
  pinMode(trigPin, OUTPUT);
  pinMode(echoPin, INPUT);
  Serial.begin(9600);
}

void loop() {
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);
  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);

  long duration = pulseIn(echoPin, HIGH, 30000);
  float cm = duration * 0.0343 / 2.0;
  Serial.print("distance_cm:");
  Serial.println(cm);
  delay(100);
}
`,
  },
  {
    id: 'dht', title: 'Temperature and humidity (DHT11/22)', category: 'Sensors', board: UNO, libraries: ['DHT sensor library', 'Adafruit Unified Sensor'],
    description: 'Reads a DHT11 or DHT22 and prints temperature and humidity.',
    wiring: 'DHT module: VCC -> 5V, GND -> GND, DATA -> pin 2 (a bare sensor needs a 10 kohm pull-up between DATA and VCC).\nFor a DHT22 change DHTTYPE to DHT22.\nLibraries: DHT sensor library and Adafruit Unified Sensor (Tools > Manage libraries).',
    code: `#include <DHT.h>

// DHT11 / DHT22: install "DHT sensor library" and "Adafruit Unified Sensor".
#define DHTPIN 2
#define DHTTYPE DHT11

DHT dht(DHTPIN, DHTTYPE);

void setup() {
  Serial.begin(9600);
  dht.begin();
}

void loop() {
  delay(2000);
  float humidity = dht.readHumidity();
  float temperature = dht.readTemperature();
  if (isnan(humidity) || isnan(temperature)) {
    Serial.println("Could not read the sensor");
    return;
  }
  Serial.print("temp:");
  Serial.print(temperature);
  Serial.print(" hum:");
  Serial.println(humidity);
}
`,
  },
  {
    id: 'lcd', title: 'LCD 16x2 (I2C) hello', category: 'Displays', board: UNO, libraries: ['LiquidCrystal I2C'],
    description: 'Writes text on a 16x2 character LCD with an I2C backpack.',
    wiring: 'I2C backpack: VCC -> 5V, GND -> GND, SDA -> A4, SCL -> A5 (on a Mega: SDA 20, SCL 21).\nThe I2C address is often 0x27 or 0x3F.\nLibrary: LiquidCrystal I2C.',
    code: `#include <Wire.h>
#include <LiquidCrystal_I2C.h>

// 16 columns, 2 rows. If nothing shows, try the address 0x3F and turn the contrast screw.
LiquidCrystal_I2C lcd(0x27, 16, 2);

void setup() {
  lcd.init();
  lcd.backlight();
  lcd.setCursor(0, 0);
  lcd.print("Hello, kArduino!");
}

void loop() {
  lcd.setCursor(0, 1);
  lcd.print("up ");
  lcd.print(millis() / 1000);
  lcd.print(" s   ");
  delay(250);
}
`,
  },
  {
    id: 'traffic', title: 'Traffic light (state machine)', category: 'LEDs', board: UNO, libraries: [],
    description: 'Red, green and yellow LEDs run by a small state machine with millis().',
    wiring: 'Red LED -> pin 8, yellow LED -> pin 9, green LED -> pin 10, each through a 220 ohm resistor to the LED anode; all cathodes -> GND.',
    code: `// Traffic light: three states, each lasts a different time.
const int redPin = 8;
const int yellowPin = 9;
const int greenPin = 10;

enum State { RED, GREEN, YELLOW };
State state = RED;
unsigned long stateStart = 0;

unsigned long durationOf(State s) {
  if (s == RED) return 4000;
  if (s == GREEN) return 3000;
  return 1000;
}

void show(State s) {
  digitalWrite(redPin, s == RED);
  digitalWrite(yellowPin, s == YELLOW);
  digitalWrite(greenPin, s == GREEN);
}

void setup() {
  pinMode(redPin, OUTPUT);
  pinMode(yellowPin, OUTPUT);
  pinMode(greenPin, OUTPUT);
  show(state);
}

void loop() {
  if (millis() - stateStart >= durationOf(state)) {
    stateStart = millis();
    if (state == RED) state = GREEN;
    else if (state == GREEN) state = YELLOW;
    else state = RED;
    show(state);
  }
}
`,
  },
  {
    id: 'knight-rider', title: 'Knight Rider', category: 'LEDs', board: UNO, libraries: [],
    description: 'Six LEDs with a light that runs back and forth.',
    wiring: 'Six LEDs on pins 2 to 7, each through a 220 ohm resistor to the LED anode; all cathodes -> GND.',
    code: `// Knight Rider: a moving light on six LEDs.
const int firstPin = 2;
const int lastPin = 7;

void setup() {
  for (int pin = firstPin; pin <= lastPin; pin++) {
    pinMode(pin, OUTPUT);
  }
}

void sweep(int from, int to, int stepBy) {
  for (int pin = from; pin != to + stepBy; pin += stepBy) {
    digitalWrite(pin, HIGH);
    delay(70);
    digitalWrite(pin, LOW);
  }
}

void loop() {
  sweep(firstPin, lastPin, 1);
  sweep(lastPin - 1, firstPin + 1, -1);
}
`,
  },
  {
    id: 'tone', title: 'Tone melody', category: 'Sound', board: UNO, libraries: [],
    description: 'Plays a short melody on a piezo buzzer with tone().',
    wiring: 'Piezo buzzer: + -> pin 8, - -> GND (a passive buzzer; an active one only beeps).',
    code: `// Tone melody: frequencies in Hz and note lengths (4 = quarter note).
#define NOTE_C4 262
#define NOTE_D4 294
#define NOTE_E4 330
#define NOTE_F4 349
#define NOTE_G4 392
#define NOTE_A4 440

const int buzzerPin = 8;
const int melody[] = {NOTE_C4, NOTE_C4, NOTE_G4, NOTE_G4, NOTE_A4, NOTE_A4, NOTE_G4,
                      NOTE_F4, NOTE_F4, NOTE_E4, NOTE_E4, NOTE_D4, NOTE_D4, NOTE_C4};
const int lengths[] = {4, 4, 4, 4, 4, 4, 2, 4, 4, 4, 4, 4, 4, 2};

void setup() {
  for (int i = 0; i < 14; i++) {
    int ms = 1000 / lengths[i];
    tone(buzzerPin, melody[i], ms);
    delay(ms * 1.3);
    noTone(buzzerPin);
  }
}

void loop() {
}
`,
  },
  {
    id: 'millis-blink', title: 'Blink without delay (millis)', category: 'Timing', board: UNO, libraries: [],
    description: 'Blinks an LED with millis() so the loop stays free for other work.',
    wiring: 'Built-in LED on pin 13, or an external LED on pin 13 through 220 ohm to GND.',
    code: `// Non-blocking blink: loop() keeps running, so it can do other things as well.
const int ledPin = 13;
const unsigned long interval = 500;
unsigned long previous = 0;
int ledState = LOW;

void setup() {
  pinMode(ledPin, OUTPUT);
}

void loop() {
  unsigned long now = millis();
  if (now - previous >= interval) {
    previous = now;
    ledState = (ledState == LOW) ? HIGH : LOW;
    digitalWrite(ledPin, ledState);
  }
  // other work can go here
}
`,
  },
  {
    id: 'interrupt', title: 'Interrupt button', category: 'Timing', board: UNO, libraries: [],
    description: 'A button on an interrupt pin toggles the LED at once, even during a delay().',
    wiring: 'Button between pin 2 (interrupt INT0) and GND, using INPUT_PULLUP. Pins 2 and 3 are the interrupt pins of an Uno.\nLED on pin 13 (built-in).',
    code: `// Interrupt: onPress() runs as soon as pin 2 goes from HIGH to LOW.
const int buttonPin = 2;
const int ledPin = 13;
volatile bool ledOn = false;
volatile unsigned long lastPress = 0;

void onPress() {
  unsigned long now = millis();
  if (now - lastPress > 200) {
    ledOn = !ledOn;
    lastPress = now;
  }
}

void setup() {
  pinMode(buttonPin, INPUT_PULLUP);
  pinMode(ledPin, OUTPUT);
  attachInterrupt(digitalPinToInterrupt(buttonPin), onPress, FALLING);
}

void loop() {
  digitalWrite(ledPin, ledOn);
  delay(1000);  // the button still reacts during this delay
}
`,
  },
  {
    id: 'eeprom', title: 'EEPROM counter', category: 'Memory', board: UNO, libraries: [],
    description: 'Counts the number of times the board started, and remembers it after power off.',
    wiring: 'Nothing to wire. Each EEPROM cell survives about 100 000 writes: do not write it in loop().',
    code: `#include <EEPROM.h>

// The start counter lives in EEPROM address 0 and survives a power cut.
const int address = 0;

void setup() {
  Serial.begin(9600);
  unsigned int count;
  EEPROM.get(address, count);
  if (count == 0xFFFF) {
    count = 0;  // a new EEPROM reads as 0xFFFF
  }
  count++;
  EEPROM.put(address, count);
  Serial.print("This board has started ");
  Serial.print(count);
  Serial.println(" times.");
}

void loop() {
}
`,
  },
  {
    id: 'stepper', title: 'Stepper motor (28BYJ-48)', category: 'Motors', board: UNO, libraries: ['Stepper'],
    description: 'Turns a 28BYJ-48 stepper (ULN2003 driver) one revolution each way.',
    wiring: 'ULN2003 board: IN1 -> pin 8, IN2 -> pin 9, IN3 -> pin 10, IN4 -> pin 11; VCC -> 5V, GND -> GND.\nThe Stepper library comes with the Arduino IDE; the coil order 8-10-9-11 is correct for this motor.',
    code: `#include <Stepper.h>

// 28BYJ-48: 2048 steps per revolution. The coil order is 1-3-2-4.
const int stepsPerRevolution = 2048;
Stepper stepper(stepsPerRevolution, 8, 10, 9, 11);

void setup() {
  stepper.setSpeed(10);  // revolutions per minute
}

void loop() {
  stepper.step(stepsPerRevolution);
  delay(500);
  stepper.step(-stepsPerRevolution);
  delay(500);
}
`,
  },
  {
    id: 'seven-seg', title: '7-segment counter', category: 'Displays', board: UNO, libraries: [],
    description: 'Counts from 0 to 9 on a common-cathode 7-segment display.',
    wiring: 'Segments a, b, c, d, e, f, g -> pins 2 to 8, each through a 220 ohm resistor.\nThe common pin -> GND (common cathode). For a common anode, connect it to 5V and swap HIGH and LOW.',
    code: `// 7-segment display, common cathode. Bit order: a b c d e f g (bit 0 = a).
const int segmentPins[7] = {2, 3, 4, 5, 6, 7, 8};
const byte digits[10] = {
  0b0111111, 0b0000110, 0b1011011, 0b1001111, 0b1100110,
  0b1101101, 0b1111101, 0b0000111, 0b1111111, 0b1101111
};

void show(int n) {
  for (int s = 0; s < 7; s++) {
    digitalWrite(segmentPins[s], (digits[n] >> s) & 1);
  }
}

void setup() {
  for (int s = 0; s < 7; s++) {
    pinMode(segmentPins[s], OUTPUT);
  }
}

void loop() {
  for (int n = 0; n < 10; n++) {
    show(n);
    delay(700);
  }
}
`,
  },
  {
    id: 'neopixel', title: 'NeoPixel rainbow', category: 'LEDs', board: UNO, libraries: ['Adafruit NeoPixel'],
    description: 'A rainbow that rolls along a WS2812 (NeoPixel) strip.',
    wiring: 'Strip DIN -> pin 6 through a 330 ohm resistor; 5V -> 5V (an external supply for more than a few LEDs, 60 mA each at full white); GND -> GND, shared with the Arduino.\nLibrary: Adafruit NeoPixel.',
    code: `#include <Adafruit_NeoPixel.h>

// Rainbow on 16 NeoPixels. Install "Adafruit NeoPixel" first.
const int ledPin = 6;
const int ledCount = 16;
Adafruit_NeoPixel strip(ledCount, ledPin, NEO_GRB + NEO_KHZ800);
long firstHue = 0;

void setup() {
  strip.begin();
  strip.setBrightness(40);
  strip.show();
}

void loop() {
  for (int i = 0; i < ledCount; i++) {
    long hue = firstHue + (i * 65536L / ledCount);
    strip.setPixelColor(i, strip.gamma32(strip.ColorHSV(hue)));
  }
  strip.show();
  firstHue += 256;
  delay(10);
}
`,
  },
  {
    id: 'tmp36', title: 'Temperature sensor TMP36', category: 'Sensors', board: UNO, libraries: [],
    description: 'Reads a TMP36 and prints the temperature as temp:value for the serial plotter.',
    wiring: 'TMP36 (flat side towards you): left pin -> 5V, middle pin -> A0, right pin -> GND.\nA 0.1 uF capacitor between the left pin and GND steadies the reading.',
    code: `// TMP36: 10 mV per degree Celsius with a 500 mV offset.
const int sensorPin = A0;

void setup() {
  Serial.begin(9600);
}

void loop() {
  int reading = analogRead(sensorPin);
  float volts = reading * 5.0 / 1024.0;
  float celsius = (volts - 0.5) * 100.0;
  Serial.print("temp:");
  Serial.println(celsius);
  delay(500);
}
`,
  },
  {
    id: 'relay', title: 'Relay timer', category: 'Motors', board: UNO, libraries: [],
    description: 'Switches a relay on for 10 seconds, then off for 5, using millis().',
    wiring: 'Relay module: VCC -> 5V, GND -> GND, IN -> pin 7. Many modules switch ON when IN is LOW: set ACTIVE_LOW below.\nSwitch only low-voltage loads yourself; mains voltage is dangerous.',
    code: `// Relay timer: on 10 s, off 5 s.
const int relayPin = 7;
const bool ACTIVE_LOW = true;
const unsigned long onTime = 10000;
const unsigned long offTime = 5000;

bool relayOn = false;
unsigned long changedAt = 0;

void setRelay(bool on) {
  relayOn = on;
  digitalWrite(relayPin, (on != ACTIVE_LOW) ? HIGH : LOW);
}

void setup() {
  pinMode(relayPin, OUTPUT);
  setRelay(false);
  Serial.begin(9600);
}

void loop() {
  unsigned long wait = relayOn ? onTime : offTime;
  if (millis() - changedAt >= wait) {
    changedAt = millis();
    setRelay(!relayOn);
    Serial.println(relayOn ? "relay on" : "relay off");
  }
}
`,
  },
  {
    id: 'morse', title: 'Morse code', category: 'LEDs', board: UNO, libraries: [],
    description: 'Sends a message in Morse code on the built-in LED.',
    wiring: 'Nothing to wire: the built-in LED (pin 13) flashes. Add an external LED on pin 13 if you like.',
    code: `// Morse code on the LED. A dot is 1 unit, a dash 3, the gap between letters 3, words 7.
const int ledPin = 13;
const int unit = 200;
const char* letters[] = {
  ".-", "-...", "-.-.", "-..", ".", "..-.", "--.", "....", "..", ".---", "-.-", ".-..", "--",
  "-.", "---", ".--.", "--.-", ".-.", "...", "-", "..-", "...-", ".--", "-..-", "-.--", "--.."
};
const char* numbers[] = {"-----", ".----", "..---", "...--", "....-", ".....", "-....", "--...", "---..", "----."};

void flash(int units) {
  digitalWrite(ledPin, HIGH);
  delay(units * unit);
  digitalWrite(ledPin, LOW);
  delay(unit);
}

void sendSymbols(const char* code) {
  for (int i = 0; code[i] != 0; i++) {
    flash(code[i] == '.' ? 1 : 3);
  }
  delay(2 * unit);
}

void sendMessage(const char* text) {
  for (int i = 0; text[i] != 0; i++) {
    char c = toupper(text[i]);
    if (c >= 'A' && c <= 'Z') sendSymbols(letters[c - 'A']);
    else if (c >= '0' && c <= '9') sendSymbols(numbers[c - '0']);
    else delay(4 * unit);
  }
}

void setup() {
  pinMode(ledPin, OUTPUT);
}

void loop() {
  sendMessage("SOS KHERVE");
  delay(3000);
}
`,
  },
]

export const EXAMPLE_CATEGORIES: string[] = [...new Set(EXAMPLES.map((e) => e.category))]

export const exampleById = (id: string): Example | undefined => EXAMPLES.find((e) => e.id === id)

/** A fresh sketch. */
export const NEW_SKETCH = `void setup() {
  // runs once
}

void loop() {
  // runs again and again
}
`

export const SNIPPETS: Snippet[] = [
  { id: 'skeleton', title: 'setup() and loop()', code: NEW_SKETCH },
  { id: 'pinmode', title: 'pinMode', code: 'pinMode(LED_BUILTIN, OUTPUT);\n' },
  { id: 'serial', title: 'Serial.begin', code: 'Serial.begin(9600);\n' },
  { id: 'print', title: 'Serial.println', code: 'Serial.println(value);\n' },
  { id: 'dwrite', title: 'digitalWrite / digitalRead', code: 'digitalWrite(13, HIGH);\nint state = digitalRead(2);\n' },
  { id: 'awrite', title: 'analogRead / analogWrite', code: 'int reading = analogRead(A0);\nanalogWrite(9, reading / 4);\n' },
  { id: 'millis', title: 'millis() timer', code: 'static unsigned long last = 0;\nif (millis() - last >= 1000) {\n  last = millis();\n  // runs once a second\n}\n' },
  { id: 'map', title: 'map and constrain', code: 'int scaled = map(reading, 0, 1023, 0, 255);\nscaled = constrain(scaled, 0, 255);\n' },
  { id: 'ifelse', title: 'if / else', code: 'if (condition) {\n  // then\n} else {\n  // otherwise\n}\n' },
  { id: 'for', title: 'for loop', code: 'for (int i = 0; i < 10; i++) {\n  \n}\n' },
  { id: 'while', title: 'while loop', code: 'while (condition) {\n  \n}\n' },
  { id: 'function', title: 'Function', code: 'int addTwo(int a, int b) {\n  return a + b;\n}\n' },
  { id: 'interrupt', title: 'attachInterrupt', code: 'attachInterrupt(digitalPinToInterrupt(2), onEvent, FALLING);\n' },
  { id: 'servo', title: 'Servo', code: '#include <Servo.h>\nServo servo;\n// in setup(): servo.attach(9);\n// in loop():  servo.write(90);\n' },
  { id: 'define', title: 'Pin constant', code: 'const int ledPin = 9;\n' },
]
