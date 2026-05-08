#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <termios.h>
#include <time.h>

#define UART_DEVICE "/dev/ttyS0"
#define ITERATIONS 30

static void send_command(int fd, const char *cmd) {
    ssize_t n = write(fd, cmd, strlen(cmd));
    if (n < 0) perror("write failed");
    else if ((size_t)n != strlen(cmd)) fprintf(stderr, "partial write\n");
}

static void read_response(int fd) {
    char rx[256];
    int n = read(fd, rx, sizeof(rx) - 1);
    if (n > 0) {
        rx[n] = '\0';
        printf("RX: %s", rx);
    } else {
        printf("No response\n");
    }
}

static void run_test(int fd, const char *label, const char *cmd) {
    printf("[*] Testing %s...\n", label);
    for (int i = 0; i < ITERATIONS; i++) {
        send_command(fd, cmd);
        usleep(100000);
        read_response(fd);
    }
}

int main() {
    int fd = open(UART_DEVICE, O_RDWR | O_NOCTTY | O_NONBLOCK);
    if (fd < 0) { perror("Failed to open UART"); return 1; }

    struct termios tty;
    if (tcgetattr(fd, &tty) != 0) { perror("tcgetattr failed"); close(fd); return 1; }

    cfsetispeed(&tty, B115200);
    cfsetospeed(&tty, B115200);
    tty.c_cflag &= ~PARENB;
    tty.c_cflag &= ~CSTOPB;
    tty.c_cflag &= ~CSIZE;
    tty.c_cflag |= CS8 | CLOCAL | CREAD;
    tty.c_iflag &= ~(IXON | IXOFF | IXANY | IGNBRK | BRKINT |
                     PARMRK | ISTRIP | INLCR | IGNCR | ICRNL);
    tty.c_lflag &= ~(ICANON | ECHO | ECHOE | ISIG);
    tty.c_oflag &= ~OPOST;
    tty.c_cc[VMIN] = 0;
    tty.c_cc[VTIME] = 1;

    tcflush(fd, TCIOFLUSH);
    if (tcsetattr(fd, TCSANOW, &tty) != 0) { perror("tcsetattr failed"); close(fd); return 1; }

    printf("[*] UART open. Starting tests...\n");
    sleep(1);

    run_test(fd, "Left Wheel",       "L:100,R:0,B:0\n");
    run_test(fd, "Right Wheel",      "L:0,R:100,B:0\n");
    run_test(fd, "Forward",          "L:100,R:100,B:0\n");
    run_test(fd, "Boost (Max Power)","L:100,R:100,B:1\n");

    printf("[*] Stopping motors...\n");
    send_command(fd, "L:0,R:0,B:0\n");
    sleep(1);

    close(fd);
    printf("[*] Test complete.\n");
    return 0;
}
