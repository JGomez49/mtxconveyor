


let chartInstances = [];

function parseDate(value) {
    const parsed = Date.parse(value);
    if (!isNaN(parsed)) return new Date(parsed);
    return null;
}

function renderChartsFromTable() {
    const table = document.getElementById("csvTable");
    const rows = Array.from(table.querySelectorAll("tbody tr"));

    const vpMap = {};
    rows.forEach(row => {
    const cells = row.querySelectorAll("td");
    const rig = cells[0]?.innerText.trim();
    const dp = cells[1]?.innerText.trim();
    const type = cells[2]?.innerText.trim();
    const duration = Number(cells[3]?.innerText.trim() || 0);
    const vp = cells[4]?.innerText.trim();
    const start = parseDate(cells[5]?.innerText.trim());
    const site = cells[6]?.innerText.trim();
    const well = cells[7]?.innerText.trim();

    if (!start) return;
    if (!vpMap[vp]) vpMap[vp] = {};
    if (!vpMap[vp][rig]) vpMap[vp][rig] = [];
    vpMap[vp][rig].push({ rig, dp, type, duration, vp, start, site, well });
    });

    const today = new Date();
    const twoMonthsLater = new Date(today.getFullYear(), today.getMonth() + 2, today.getDate());
    const threeMonthsLater = new Date(today.getFullYear(), today.getMonth() + 3, today.getDate());
    const sixMonthsLater = new Date(today.getFullYear(), today.getMonth() + 6, today.getDate());

    const chartDiv = document.getElementById("chartDiv");
    chartDiv.innerHTML = "";

    Object.keys(vpMap).forEach(vp => {
    const rigs = Object.keys(vpMap[vp]);
    const datasets = [];
    const colors = [];
    const colorCounts = { blue: 0, red: 0, green: 0, yellow: 0 };

    rigs.forEach(rig => {
        vpMap[vp][rig].forEach(siteObj => {
        const end = new Date(siteObj.start.getTime() + siteObj.duration * 86400000);
        const dpValue = siteObj.dp || "";
        const isEmptyDP = !dpValue || dpValue === "***";
        const type = siteObj.type;

        datasets.push({
            y: rig,
            x: [siteObj.start, end],
            site: siteObj.site.substring(0, 5),
            details: {
            Rig: rig,
            VP: vp,
            Start: siteObj.start.toLocaleDateString(),
            Duration: siteObj.duration,
            DP: dpValue,
            Site: siteObj.site,
            Well: siteObj.well,
            type: type
            }
        });

        if (!isEmptyDP && (type === "EXEC" || type === "PRELIM-IR" || type === "PRELIM")) {
            colors.push("#0084c7"); // Blue
            colorCounts.blue++;
        } else if (isEmptyDP && (type === "EXEC" || type === "PRELIM-IR" || type === "PRELIM" || type === "")) {
            colors.push("#ff4c4c"); // Red
            colorCounts.red++;
        } else if (type === "FINAL") {
            colors.push("#4caf50"); // Green
            colorCounts.green++;
        } else {
            colors.push("#ffff00"); // Yellow fallback
            colorCounts.yellow++;
        }
        });
    });

    // VP title
    const title = document.createElement("h3");
    title.textContent = `VP: ${vp}`;
    title.style.color = "white";
    chartDiv.appendChild(title);

    // Date boundaries
    const minDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 7);
    const maxDate = sixMonthsLater;

    // Canvas for Gantt
    const canvas = document.createElement("canvas");
    canvas.height = Math.max(200, rigs.length * 40);
    chartDiv.appendChild(canvas);

    const ctx = canvas.getContext("2d");
    const chart = new Chart(ctx, {
        type: "bar",
        data: {
        datasets: [{
            label: "Schedule",
            data: datasets,
            backgroundColor: colors,
            borderRadius: 6,
            borderSkipped: false,
            borderColor: "#000",
            borderWidth: 1,
            parsing: { xAxisKey: "x", yAxisKey: "y" }
        }]
        },
        options: {
        indexAxis: "y",
        responsive: false,
        maintainAspectRatio: false,
        scales: {
            x: {
            type: "time",
            time: { unit: "day", stepSize: 1, tooltipFormat: "dd-MMM-yyyy", displayFormats: { day: "dd-MMM" } },
            min: today,
            max: sixMonthsLater,
            ticks: { color: "#ccc" },
            grid: { color: "#333" }
            },
            y: {
            type: "category",
            labels: rigs,
            ticks: { color: "#ccc", font: { weight: "bold" } },
            grid: { color: "#333" }
            }
        },
        plugins: {
            legend: { display: false },
            tooltip: {
            callbacks: {
                label: (ctx) => {
                const d = ctx.raw.details;
                return [
                    `Rig: ${d.Rig}`,
                    `VP: ${d.VP}`,
                    `Start: ${d.Start}`,
                    `Duration: ${d.Duration} days`,
                    `DP: ${d.DP}`,
                    `Site: ${d.Site}`,
                    `Well: ${d.Well}`,
                    `Type: ${d.type}`
                ];
                }
            }
            },
            datalabels: {
            anchor: "center",
            align: "center",
            color: "#000",
            font: { weight: "bold" },
            formatter: (value) => value.site
            },
            annotation: {
            annotations: {
                futureBox: {
                type: "box",
                xMin: twoMonthsLater,
                xMax: threeMonthsLater,
                backgroundColor: "rgba(255,0,0,0.15)",
                borderWidth: 0.5,
                borderColor: "red"
                },
                todayLine: {
                type: "line",
                xMin: today,
                xMax: today,
                borderColor: "red",
                borderWidth: 2,
                label: { enabled: true, content: "Today", position: "start", color: "red" }
                }
            }
            },
            zoom: {
                zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: "x" },
                pan: { enabled: true, mode: "x" },
                limits: { x: { min: minDate, max: maxDate } }
            }
        },
        barThickness: 18
        },
        plugins: [ChartDataLabels]
    });

    chartInstances.push(chart);

    // -------------------------
    // 📊 Summary Table + Pie
    // -------------------------
    const totalBars = colorCounts.blue + colorCounts.red + colorCounts.green + colorCounts.yellow;

    const summaryTable = document.createElement("table");
    summaryTable.className = "table table-dark table-sm table-bordered mt-2";
    summaryTable.innerHTML = `
        <thead>
        <tr>
            <th style="background-color:#0084c7">Done</th>
            <th style="background-color:#ff4c4c">In-Progress</th>
            <th style="background-color:#4caf50">Sent</th>
            <th style="color:#1a1a1a; background-color:#ffff00">Need Info.</th>
            <th>Total</th>
        </tr>
        </thead>
        <tbody>
        <tr>
            <td>${colorCounts.blue}</td>
            <td>${colorCounts.red}</td>
            <td>${colorCounts.green}</td>
            <td>${colorCounts.yellow}</td>
            <td><b>${totalBars}</b></td>
        </tr>
        </tbody>
    `;
    chartDiv.appendChild(summaryTable);

    // Pie Chart
    const pieCanvas = document.createElement("canvas");
    pieCanvas.style.maxWidth = "300px";
    pieCanvas.style.maxHeight = "300px";
    pieCanvas.className = "mb-4";
    chartDiv.appendChild(pieCanvas);

    new Chart(pieCanvas.getContext("2d"), {
        type: "pie",
        data: {
        labels: ["Done", "In-progress", "Sent", "Need Info."],
        datasets: [{
            data: [colorCounts.blue, colorCounts.red, colorCounts.green, colorCounts.yellow],
            backgroundColor: ["#0084c7", "#ff4c4c", "#4caf50", "#ffff00"],
            borderColor: "#222",
            borderWidth: 1
        }]
        },
        options: {
        plugins: {
            legend: { position: "bottom", labels: { color: "#fff" } },
            datalabels: {
            color: "#000",
            font: { weight: "bold" },
            formatter: (value, ctx) => {
                let total = ctx.chart.data.datasets[0].data.reduce((a, b) => a + b, 0);
                return total > 0 ? (value / total * 100).toFixed(1) + "%" : "0%";
            }
            }
        }
        },
        plugins: [ChartDataLabels]
    });
    });
}

window.addEventListener("DOMContentLoaded", renderChartsFromTable);
