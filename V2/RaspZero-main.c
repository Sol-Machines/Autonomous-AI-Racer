#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <termios.h>
#include <errno.h>
#include <time.h>

#define UART_DEVICE "/dev/ttyS0"
#define UART_BAUD   B115200

#define CAM_WIDTH   160
#define CAM_HEIGHT  120
#define CAM_FPS     15
#define FRAME_SIZE  (CAM_WIDTH * CAM_HEIGHT * 3 / 2)  /* YUV420 */

/* ---- UART functions ---- */

int uart_open(const char *device) {
    int fd = open(device, O_RDWR | O_NOCTTY | O_NONBLOCK);
    if (fd < 0) {
        perror("UART open failed");
        return -1;
    }

    struct termios tty;
    tcgetattr(fd, &tty);

    cfsetispeed(&tty, UART_BAUD);
    cfsetospeed(&tty, UART_BAUD);

    tty.c_cflag &= ~PARENB;
    tty.c_cflag &= ~CSTOPB;
    tty.c_cflag &= ~CSIZE;
    tty.c_cflag |= CS8;
    tty.c_cflag |= CLOCAL | CREAD;

    tty.c_iflag &= ~(IXON | IXOFF | IXANY);
    tty.c_iflag &= ~(IGNBRK | BRKINT | PARMRK | ISTRIP |
                      INLCR | IGNCR | ICRNL);
    tty.c_lflag &= ~(ICANON | ECHO | ECHOE | ISIG);
    tty.c_oflag &= ~OPOST;

    tty.c_cc[VMIN] = 0;
    tty.c_cc[VTIME] = 1;

    tcflush(fd, TCIOFLUSH);
    tcsetattr(fd, TCSANOW, &tty);

    return fd;
}

int uart_send(int fd, int left, int right, int boost) {
    char cmd[64];
    int len = snprintf(cmd, sizeof(cmd),
                       "L:%d,R:%d,B:%d\n", left, right, boost);
    return write(fd, cmd, len);
}

int uart_read_line(int fd, char *buf, int buf_size) {
    int n = read(fd, buf, buf_size - 1);
    if (n > 0) {
        buf[n] = '\0';
    }
    return n;
}

/* ---- Camera functions ---- */

FILE *camera_open(void) {
    char cmd[256];
    snprintf(cmd, sizeof(cmd),
        "rpicam-vid -t 0 --width %d --height %d "
        "--framerate %d --codec yuv420 -n -o -",
        CAM_WIDTH, CAM_HEIGHT, CAM_FPS);

    FILE *pipe = popen(cmd, "r");
    if (!pipe) {
        perror("Camera open failed");
        return NULL;
    }

    printf("Camera started: %dx%d @ %dfps\n",
           CAM_WIDTH, CAM_HEIGHT, CAM_FPS);
    return pipe;
}

int camera_read_frame(FILE *pipe, unsigned char *frame) {
    int total = 0;
    while (total < FRAME_SIZE) {
        int n = fread(frame + total, 1, FRAME_SIZE - total, pipe);
        if (n <= 0) {
            return -1;  /* pipe closed or error */
        }
        total += n;
    }
    return 0;
}

/* ---- Main ---- */

int main() {
    printf("RC Car Controller starting...\n");

    /* Open UART */
    int uart_fd = uart_open(UART_DEVICE);
    if (uart_fd < 0) return 1;
    printf("UART open on %s\n", UART_DEVICE);

    /* Open camera */
    FILE *cam = camera_open();
    if (!cam) return 1;

    /* Allocate frame buffer */
    unsigned char *frame = malloc(FRAME_SIZE);
    if (!frame) {
        perror("malloc failed");
        return 1;
    }

    /* Main loop */
    char rx_buf[256];
    int frame_count = 0;
    struct timespec start, now;
    clock_gettime(CLOCK_MONOTONIC, &start);

    printf("Running... Press Ctrl+C to stop\n");

    while (1) {
        /* Read a camera frame */
        if (camera_read_frame(cam, frame) < 0) {
            printf("Camera frame read failed\n");
            break;
        }
        frame_count++;

        /* For now, just send fixed speed (manual control comes next) */
        uart_send(uart_fd, 0, 0, 0);

        /* Read ESP32 response */
        int n = uart_read_line(uart_fd, rx_buf, sizeof(rx_buf));
        if (n > 0) {
            /* Only print battery and error messages, skip OK */
            if (strncmp(rx_buf, "BAT:", 4) == 0 ||
                strncmp(rx_buf, "WARN:", 5) == 0 ||
                strncmp(rx_buf, "ERR:", 4) == 0 ||
                strncmp(rx_buf, "SAFETY:", 7) == 0) {
                printf("%s", rx_buf);
            }
        }

        /* Print FPS every 5 seconds */
        clock_gettime(CLOCK_MONOTONIC, &now);
        double elapsed = (now.tv_sec - start.tv_sec) +
                         (now.tv_nsec - start.tv_nsec) / 1e9;
        if (elapsed >= 5.0) {
            printf("Frames: %d | FPS: %.1f\n",
                   frame_count, frame_count / elapsed);
            frame_count = 0;
            clock_gettime(CLOCK_MONOTONIC, &start);
        }
    }

    /* Cleanup */
    uart_send(uart_fd, 0, 0, 0);  /* stop motors */
    free(frame);
    pclose(cam);
    close(uart_fd);
    printf("Shutdown complete\n");

    return 0;
}
