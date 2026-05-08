/* Motor A */
#define AIN1  27
#define AIN2  26
#define PWMA  25

/* Motor B*/
#define BIN1  33
#define BIN2  32
#define PWMB  14

#define STBY  4

#define VBAT_PIN  36

/* ----- Configuration ----- */
#define BUF_SIZE 64
#define TIMEOUT_MS 500
#define BAT_REPORT_MS 2000
#define SPEED_CAP 0.80f
#define BOOST_CAP 1.00f
#define VDIV_RATIO 3.0f
#define ADC_REF_VOLTAGE 3.3f
#define ADC_MAX_VALUE 4095.0f

#define PWM_FREQ 5000
#define PWM_RESOLUTION 8

/* ----- Global State ----- */
char cmd_buf[BUF_SIZE];
int buf_pos = 0;

int left_speed = 0;
int right_speed = 0;
int boost_flag = 0;
int motors_active = 0;

unsigned long last_cmd_time = 0;
unsigned long last_bat_time = 0;

/* ----- Motor Functions ----- */

void setup_motors(void) {
    pinMode(AIN1, OUTPUT);
    pinMode(AIN2, OUTPUT);
    pinMode(BIN1, OUTPUT);
    pinMode(BIN2, OUTPUT);
    pinMode(STBY, OUTPUT);

    digitalWrite(STBY, HIGH);

    ledcAttach(PWMA, PWM_FREQ, PWM_RESOLUTION);
    ledcAttach(PWMB, PWM_FREQ, PWM_RESOLUTION);

    stop_motors();
}

void set_motor(int in1, int in2, int pwm_pin, int speed, float cap) {
    int capped = (int)(speed * cap);
    if (capped > 255) capped = 255;
    if (capped < -255) capped = -255;

    if (capped > 0) {
        digitalWrite(in1, HIGH);
        digitalWrite(in2, LOW);
        ledcWrite(pwm_pin, capped);
    } else if (capped < 0) {
        digitalWrite(in1, LOW);
        digitalWrite(in2, HIGH);
        ledcWrite(pwm_pin, -capped);
    } else {
        digitalWrite(in1, LOW);
        digitalWrite(in2, LOW);
        ledcWrite(pwm_pin, 0);
    }
}

void stop_motors(void) {
    digitalWrite(AIN1, LOW);
    digitalWrite(AIN2, LOW);
    digitalWrite(BIN1, LOW);
    digitalWrite(BIN2, LOW);
    ledcWrite(PWMA, 0);
    ledcWrite(PWMB, 0);
}

/* ----- Command Parsing ----- */

void parse_command(const char *cmd) {
    int l = 0, r = 0, b = 0;
    int parsed = sscanf(cmd, "L:%d,R:%d,B:%d", &l, &r, &b);

    if (parsed >= 2) {
        left_speed = constrain(l, -255, 255);
        right_speed = constrain(r, -255, 255);
        boost_flag = (b == 1) ? 1 : 0;
        motors_active = 1;
        last_cmd_time = millis();

        float cap = boost_flag ? BOOST_CAP : SPEED_CAP;
        set_motor(AIN1, AIN2, PWMA, left_speed, cap);
        set_motor(BIN1, BIN2, PWMB, right_speed, cap);

        Serial.print("OK L:");
        Serial.print(left_speed);
        Serial.print(" R:");
        Serial.print(right_speed);
        Serial.print(" B:");
        Serial.println(boost_flag);
    } else {
        Serial.print("ERR:PARSE ");
        Serial.println(cmd);
    }
}

/* ----- Battery Monitoring ----- */

void read_battery(void) {
    long sum = 0;
    for (int i = 0; i < 16; i++) {
        sum += analogRead(VBAT_PIN);
    }
    float adc_avg = sum / 16.0f;
    float adc_voltage = (adc_avg / ADC_MAX_VALUE) * ADC_REF_VOLTAGE;
    float bat_voltage = adc_voltage * VDIV_RATIO;

    Serial.print("BAT:");
    Serial.println(bat_voltage, 2);

    if (bat_voltage < 6.4f && bat_voltage > 1.0f) {
        Serial.println("WARN:LOW_BAT");
    }
}

/* ----- Setup ----- */

void setup() {
    Serial.begin(115200);
    analogReadResolution(12);
    pinMode(VBAT_PIN, INPUT);
    setup_motors();
    last_cmd_time = millis();
    last_bat_time = millis();
    Serial.println("ESP32 ready");
}

/* ----- Main Loop ----- */

void loop() {
    unsigned long now = millis();

    while (Serial.available()) {
        char c = Serial.read();

        if (c == '\n') {
            if (buf_pos > 0) {
                cmd_buf[buf_pos] = '\0';
                parse_command(cmd_buf);
                buf_pos = 0;
            }
        } else {
            if (buf_pos < BUF_SIZE - 1) {
                cmd_buf[buf_pos++] = c;
            } else {
                buf_pos = 0;
            }
        }
    }

    if ((now - last_cmd_time) > TIMEOUT_MS) {
        if (motors_active) {
            stop_motors();
            motors_active = 0;
            Serial.println("SAFETY:TIMEOUT");
        }
    }

    if ((now - last_bat_time) > BAT_REPORT_MS) {
        read_battery();
        last_bat_time = now;
    }
}
